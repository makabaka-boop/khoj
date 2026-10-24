import copy
import json

import pytest
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from khoj.configure import configure_middleware, configure_routes
from khoj.database.adapters import ConversationAdapters
from khoj.database.models import ChatModel, Conversation, PublicConversation
from khoj.utils import state
from khoj.utils.constants import web_directory

HEADERS = {"Authorization": "Bearer kk-secret"}
HEADERS_USER2 = {"Authorization": "Bearer kk-diff-secret"}
# POST /share validates the host against ALLOWED_HOSTS; testserver is not allowed but localhost is.
SHARE_HEADERS = {**HEADERS, "Host": "localhost"}
SHARE_HEADERS_USER2 = {**HEADERS_USER2, "Host": "localhost"}


# --------------------------------------------------------------------------------------------------
# Fixtures and message builders
# --------------------------------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def ensure_default_chat_model():
    ChatModel.objects.get_or_create(
        name="ut-share-model",
        defaults={"model_type": ChatModel.ModelType.GOOGLE},
    )


@pytest.fixture(scope="function")
def client(api_user):
    # Overrides the shared conftest `client` fixture for this module: the share endpoints do not
    # need the search index, so skip text_search.setup (its embedding worker threads race with
    # transactional test flushing and leave orphan FileObject rows).
    state.anonymous_mode = False
    app = FastAPI()
    configure_routes(app)
    configure_middleware(app)
    app.mount("/static", StaticFiles(directory=web_directory), name="static")
    return TestClient(app)


def you(question, created, **extra):
    message = {"by": "you", "message": question, "created": created}
    message.update(extra)
    return message


def khoj(answer, created, **extra):
    message = {
        "by": "khoj",
        "message": answer,
        "created": created,
        "context": [],
        "onlineContext": {},
        "codeContext": {},
    }
    message.update(extra)
    return message


def build_mixed_chat_log():
    """0: orphan khoj (legacy, unselectable)
    1-2: legacy question + answer (selectable)
    3-4: modern turn t1 with attachments, references and tool results (selectable)
    5: legacy question without answer (unselectable)
    6-7: legacy question + answer (selectable)
    8-9: modern turn t2 with an empty/interrupted khoj message (unselectable)
    """
    return [
        khoj("orphan opening note", "2024-01-01 09:00:00"),
        you("old question one", "2024-01-01 10:00:00"),
        khoj("old answer one", "2024-01-01 10:00:01"),
        you(
            "modern question",
            "2024-01-01 11:00:00",
            turnId="t1",
            images=["data:image/png;base64,AAA"],
            queryFiles=[{"name": "brief.pdf"}],
        ),
        khoj(
            "modern answer",
            "2024-01-01 11:00:01",
            turnId="t1",
            context=[{"compiled": "reference snippet", "file": "notes.md"}],
            onlineContext={
                "q": {"webpages": [{"link": "https://example.com", "snippet": "online snippet"}]}
            },
            codeContext={
                "run": {
                    "code": "print(1)",
                    "results": {"success": True, "output_files": [], "std_err": ""},
                }
            },
            trainOfThought=[{"type": "text", "data": "step by step thought"}],
        ),
        you("unanswered legacy question", "2024-01-01 12:00:00"),
        you("old question two", "2024-01-01 13:00:00"),
        khoj("old answer two", "2024-01-01 13:00:01"),
        you("interrupted modern question", "2024-01-01 14:00:00", turnId="t2"),
        khoj("", "2024-01-01 14:00:01", turnId="t2"),
    ]


def create_conversation(user, chat_log, title="Research chat"):
    return Conversation.objects.create(
        user=user, conversation_log={"chat": chat_log}, title=title
    )


def get_history(client, conversation_id, n=None, headers=None):
    url = f"/api/chat/history?client=web&conversation_id={conversation_id}"
    if n is not None:
        url += f"&n={n}"
    response = client.get(url, headers=headers or HEADERS)
    assert response.status_code == 200, response.content
    return response.json()["response"]


def first_tokens(messages):
    tokens = []
    for message in messages:
        token = message.get("shareToken")
        if token and token not in tokens:
            tokens.append(token)
    return tokens


def share_conversation(client, conversation_id, turns=None, headers=None):
    url = f"/api/chat/share?client=web&conversation_id={conversation_id}"
    kwargs = {"headers": headers or SHARE_HEADERS}
    if turns is not None:
        kwargs["json"] = {"turns": turns}
    return client.post(url, **kwargs)


def extract_slug(url):
    return url.split("/share/chat/")[1].strip("/")


def get_shared_history(client, slug, n=None, headers=None):
    url = f"/api/chat/share/history?client=web&public_conversation_slug={slug}"
    if n is not None:
        url += f"&n={n}"
    return client.get(url, headers=headers)


# --------------------------------------------------------------------------------------------------
# Unit tests for turn grouping / token resolution
# --------------------------------------------------------------------------------------------------
def test_group_chat_messages_into_turns_semantics():
    # Act
    groups = ConversationAdapters.group_chat_messages_into_turns(build_mixed_chat_log())

    # Assert: six groups, flags and ordering match the documented semantics
    assert len(groups) == 6
    assert [group.anchor_index for group in groups] == [0, 1, 3, 5, 6, 8]
    assert [group.is_selectable for group in groups] == [False, True, True, False, True, False]
    assert [group.turn_id for group in groups] == [None, None, "t1", None, None, "t2"]
    assert groups[1].messages[0]["message"] == "old question one"
    assert groups[2].token == "turn:t1"
    assert groups[2].messages[1]["context"][0]["file"] == "notes.md"
    assert groups[0].token.startswith("legacy:0:")


def test_resolve_share_tokens_roundtrip_drift_and_errors():
    # Arrange
    chat_log = build_mixed_chat_log()
    original = copy.deepcopy(chat_log)
    groups = ConversationAdapters.group_chat_messages_into_turns(chat_log)
    legacy_one_token = groups[1].token
    modern_token = groups[2].token
    legacy_two_token = groups[4].token
    interrupted_token = groups[5].token

    # Act: non-contiguous selection (legacy + modern + legacy), resolved in original log order
    selected, error = ConversationAdapters.resolve_share_tokens(
        chat_log, [legacy_two_token, modern_token, legacy_one_token, modern_token]
    )

    # Assert
    assert error is None
    assert [message["message"] for message in selected] == [
        "old question one",
        "old answer one",
        "modern question",
        "modern answer",
        "old question two",
        "old answer two",
    ]
    assert chat_log == original, "resolve must not mutate the input log"

    # Deleting an earlier message shifts legacy indexes and changes the anchor digest
    drifted_log = copy.deepcopy(chat_log)
    drifted_log.pop(0)
    selected, error = ConversationAdapters.resolve_share_tokens(drifted_log, [legacy_one_token])
    assert selected is None and "deleted or changed" in error

    # Modern turn deleted entirely
    log_without_t1 = [message for message in chat_log if message.get("turnId") != "t1"]
    selected, error = ConversationAdapters.resolve_share_tokens(log_without_t1, [modern_token])
    assert selected is None and "deleted or changed" in error

    # Incomplete turn token
    selected, error = ConversationAdapters.resolve_share_tokens(chat_log, [interrupted_token])
    assert selected is None and "incomplete" in error

    # Empty selection and malformed tokens
    assert ConversationAdapters.resolve_share_tokens(chat_log, [])[1]
    assert "invalid" in ConversationAdapters.resolve_share_tokens(chat_log, ["garbage-token"])[1]


# --------------------------------------------------------------------------------------------------
# API: history annotation
# --------------------------------------------------------------------------------------------------
@pytest.mark.django_db(transaction=True)
def test_history_annotates_share_tokens_without_persisting(client, default_user):
    # Arrange
    conversation = create_conversation(default_user, build_mixed_chat_log())

    # Act
    history = get_history(client, conversation.id)
    paged_history = get_history(client, conversation.id, n=4)

    # Assert: every returned message carries token metadata
    assert len(history["chat"]) == 10
    assert all(message["shareToken"] for message in history["chat"])
    assert all(isinstance(message["turnSelectable"], bool) for message in history["chat"])
    # user + khoj messages of turn t1 share one token and are selectable
    assert history["chat"][3]["shareToken"] == "turn:t1"
    assert history["chat"][4]["shareToken"] == "turn:t1"
    assert history["chat"][3]["turnSelectable"] and history["chat"][4]["turnSelectable"]
    # orphan, unanswered and interrupted groups are not selectable
    assert history["chat"][0]["turnSelectable"] is False
    assert history["chat"][5]["turnSelectable"] is False
    assert history["chat"][8]["turnSelectable"] is False
    assert history["chat"][9]["turnSelectable"] is False
    # tokens stay attached under n-based pagination
    assert len(paged_history["chat"]) == 4
    assert all(message["shareToken"] for message in paged_history["chat"])

    # The stored conversation log must remain free of annotation fields
    conversation.refresh_from_db()
    assert all("shareToken" not in message for message in conversation.conversation_log["chat"])
    assert all("turnSelectable" not in message for message in conversation.conversation_log["chat"])


# --------------------------------------------------------------------------------------------------
# API: full-share regression, selective snapshot, isolation
# --------------------------------------------------------------------------------------------------
@pytest.mark.django_db(transaction=True)
def test_full_share_still_copies_everything_and_can_be_unshared(client, default_user):
    # Arrange
    conversation = create_conversation(default_user, build_mixed_chat_log())

    # Act: no request body, exactly like the existing web client
    response = share_conversation(client, conversation.id)
    assert response.status_code == 200, response.content
    slug = extract_slug(response.json()["url"])

    shared = get_shared_history(client, slug)
    assert shared.status_code == 200
    assert len(shared.json()["response"]["chat"]) == 10

    # Unshare as the owner, then the public slug must be gone. The endpoint 301-redirects to the
    # chat page on success; TestClient follows redirects by default (which would replay DELETE on
    # the GET-only landing page), so disable that to assert on the redirect itself.
    delete_response = client.delete(
        f"/api/chat/share?client=web&public_conversation_slug={slug}",
        headers=HEADERS,
        follow_redirects=False,
    )
    assert delete_response.status_code == 301
    assert get_shared_history(client, slug).status_code == 404


@pytest.mark.django_db(transaction=True)
def test_selective_share_snapshots_only_selected_turns_in_order(client, default_user):
    # Arrange
    chat_log = build_mixed_chat_log()
    source_before = copy.deepcopy(chat_log)
    conversation = create_conversation(default_user, chat_log)
    history = get_history(client, conversation.id)
    tokens = first_tokens(history["chat"])
    # tokens order: orphan(legacy idx0), legacy@1, turn:t1, legacy@5(question only), legacy@6, turn:t2
    legacy_one, modern, legacy_two = tokens[1], tokens[2], tokens[4]

    # Act: non-contiguous selection submitted in arbitrary order
    response = share_conversation(client, conversation.id, turns=[legacy_two, modern, legacy_one])
    assert response.status_code == 200, response.content
    slug = extract_slug(response.json()["url"])

    # Assert: public history (unauthenticated) contains only the selected turns, in source order
    shared_response = get_shared_history(client, slug)
    assert shared_response.status_code == 200
    shared_messages = shared_response.json()["response"]["chat"]
    assert [message["message"] for message in shared_messages] == [
        "old question one",
        "old answer one",
        "modern question",
        "modern answer",
        "old question two",
        "old answer two",
    ]

    # Rich content survives untouched on the modern turn
    modern_question, modern_answer = shared_messages[2], shared_messages[3]
    assert modern_question["images"] == ["data:image/png;base64,AAA"]
    assert modern_question["queryFiles"] == [{"name": "brief.pdf"}]
    assert modern_answer["context"] == [{"compiled": "reference snippet", "file": "notes.md"}]
    assert modern_answer["onlineContext"]["q"]["webpages"][0]["link"] == "https://example.com"
    assert modern_answer["codeContext"]["run"]["results"]["success"] is True
    assert modern_answer["trainOfThought"] == [{"type": "text", "data": "step by step thought"}]

    # Nothing leaks: no annotation fields and no unselected messages
    assert all("shareToken" not in message for message in shared_messages)
    assert {"orphan opening note", "unanswered legacy question", "interrupted modern question"}.isdisjoint(
        {message["message"] for message in shared_messages}
    )

    # The source conversation is untouched
    conversation.refresh_from_db()
    assert conversation.conversation_log["chat"] == source_before


@pytest.mark.django_db(transaction=True)
def test_public_history_pagination_stays_inside_selected_subset(client, default_user):
    # Arrange
    conversation = create_conversation(default_user, build_mixed_chat_log())
    tokens = first_tokens(get_history(client, conversation.id)["chat"])
    response = share_conversation(client, conversation.id, turns=[tokens[1], tokens[2], tokens[4]])
    assert response.status_code == 200
    slug = extract_slug(response.json()["url"])
    allowed_texts = {
        "old question one",
        "old answer one",
        "modern question",
        "modern answer",
        "old question two",
        "old answer two",
    }

    # Act / Assert for every n variant used by the web client
    for n, expected_count in [(None, 6), (1, 1), (2, 2), (-1, 5)]:
        messages = get_shared_history(client, slug, n=n).json()["response"]["chat"]
        assert len(messages) == expected_count
        assert {message["message"] for message in messages} <= allowed_texts


@pytest.mark.django_db(transaction=True)
def test_invalid_share_selections_fail_with_reason_and_no_snapshot(client, default_user):
    # Arrange
    conversation = create_conversation(default_user, build_mixed_chat_log())
    tokens = first_tokens(get_history(client, conversation.id)["chat"])

    cases = [
        ("empty selection", []),
        ("unknown turn token", ["turn:deleted-id"]),
        ("malformed token", ["not-a-real-token"]),
        ("incomplete modern turn", [tokens[5]]),
        ("incomplete legacy turn", [tokens[3]]),
    ]
    for label, turns in cases:
        before = PublicConversation.objects.count()
        response = share_conversation(client, conversation.id, turns=turns)
        assert response.status_code == 400, f"{label}: {response.status_code} {response.content}"
        payload = response.json()
        assert payload["status"] == "error" and payload["message"], label
        assert PublicConversation.objects.count() == before, f"{label} created a PublicConversation"

    # A legacy token goes stale after an earlier message is deleted from the source
    stale_legacy_token = tokens[1]
    log = conversation.conversation_log["chat"]
    conversation.conversation_log["chat"] = log[1:]
    conversation.save()
    response = share_conversation(client, conversation.id, turns=[stale_legacy_token])
    assert response.status_code == 400
    assert "deleted or changed" in response.json()["message"]
    assert PublicConversation.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_share_rejects_conversations_owned_by_other_users(
    client, default_user, api_user2
):
    # Arrange: user2 owns the conversation, request is authenticated as user2
    conversation = create_conversation(api_user2.user, build_mixed_chat_log(), title="user2 chat")
    owner_tokens = first_tokens(get_history(client, conversation.id, headers=HEADERS_USER2)["chat"])

    # Act / Assert: default_user cannot share user2's conversation, even with a valid token
    response = share_conversation(
        client, conversation.id, turns=[owner_tokens[2]], headers=SHARE_HEADERS
    )
    assert response.status_code == 404
    assert PublicConversation.objects.count() == 0

    # And a missing conversation id is a 404 too
    response = share_conversation(client, "00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert PublicConversation.objects.count() == 0


@pytest.mark.django_db(transaction=True)
def test_snapshot_is_independent_of_later_source_changes(client, default_user):
    # Arrange
    chat_log = build_mixed_chat_log()
    conversation = create_conversation(default_user, chat_log, title="Frozen title")
    tokens = first_tokens(get_history(client, conversation.id)["chat"])
    response = share_conversation(client, conversation.id, turns=[tokens[1], tokens[2]])
    slug = extract_slug(response.json()["url"])
    before = get_shared_history(client, slug).json()["response"]

    # Act: source gains a turn, loses a selected turn and is renamed after sharing
    log = conversation.conversation_log["chat"]
    log.extend(
        [
            you("brand new question", "2024-01-02 10:00:00", turnId="t9"),
            khoj("brand new answer", "2024-01-02 10:00:01", turnId="t9"),
        ]
    )
    conversation.conversation_log["chat"] = [m for m in log if m.get("turnId") != "t1"]
    conversation.title = "Renamed title"
    conversation.save()

    # Assert
    after = get_shared_history(client, slug).json()["response"]
    assert after["chat"] == before["chat"]
    assert after["slug"] == before["slug"] == "Frozen title"
    assert [m["message"] for m in after["chat"]] == [
        "old question one",
        "old answer one",
        "modern question",
        "modern answer",
    ]


@pytest.mark.django_db(transaction=True)
def test_fork_selective_share_copies_only_selected_messages(client, default_user):
    # Arrange
    conversation = create_conversation(default_user, build_mixed_chat_log())
    tokens = first_tokens(get_history(client, conversation.id)["chat"])
    response = share_conversation(client, conversation.id, turns=[tokens[1], tokens[2], tokens[4]])
    slug = extract_slug(response.json()["url"])

    # Act
    fork_response = client.post(
        f"/api/chat/share/fork?client=web&public_conversation_slug={slug}", headers=HEADERS
    )
    assert fork_response.status_code == 200, fork_response.content
    forked_id = fork_response.json()["conversation_id"]

    # Assert: private fork belongs to the acting user and contains the subset only
    forked_history = get_history(client, forked_id)
    assert [message["message"] for message in forked_history["chat"]] == [
        "old question one",
        "old answer one",
        "modern question",
        "modern answer",
        "old question two",
        "old answer two",
    ]
    # Public snapshot stays intact
    public_messages = get_shared_history(client, slug).json()["response"]["chat"]
    assert len(public_messages) == 6
