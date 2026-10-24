# System Packages
import base64
from types import SimpleNamespace

import pytest

from khoj.processor.conversation.utils import ResearchIteration, ToolCall
from khoj.processor.tools.run_code import (
    GeneratedFile,
    GeneratedFileReferenceError,
    assign_generated_file_aliases,
    build_generated_files_context,
    encode_generated_file_for_sandbox,
    format_generated_files_for_planning,
    resolve_generated_file_references,
)
from khoj.routers.research import ToolExecutionResult, execute_tool, record_completed_step
from khoj.utils.helpers import ConversationCommand


def make_step_status(name: str = ConversationCommand.PythonCoder.value, **kwargs):
    status = {"name": name, "success": False, "warning": None, "files": []}
    status.update(kwargs)
    return status


# ---------------------------------------------------------------------------
# resolve_generated_file_references
# ---------------------------------------------------------------------------


def test_resolve_valid_references_returns_full_content():
    full_text = "col1,col2\n1,2\n"
    image_b64 = base64.b64encode(b"\x89PNG fake").decode("utf-8")
    available = [
        GeneratedFile(source_step=2, filename="data.csv", b64_data=full_text),
        GeneratedFile(source_step=3, filename="chart.png", b64_data=image_b64),
    ]
    status = {
        2: make_step_status(success=True, files=["data.csv"]),
        3: make_step_status(success=True, files=["chart.png"]),
    }

    resolved = resolve_generated_file_references(
        [
            {"filename": "data.csv", "source_step": 2},
            {"filename": "chart.png", "source_step": 3},
        ],
        available,
        status,
    )

    assert len(resolved) == 2
    assert resolved[0]["filename"] == "data.csv"
    assert resolved[0]["b64_data"] == full_text
    assert resolved[1]["b64_data"] == image_b64


def test_same_named_files_from_different_steps_resolve_separately():
    available = [
        GeneratedFile(source_step=2, filename="out.csv", b64_data="version-1"),
        GeneratedFile(source_step=4, filename="out.csv", b64_data="version-2"),
    ]
    status = {
        2: make_step_status(success=True, files=["out.csv"]),
        4: make_step_status(success=True, files=["out.csv"]),
    }

    resolved = resolve_generated_file_references(
        [
            {"filename": "out.csv", "source_step": 2},
            {"filename": "out.csv", "source_step": 4},
        ],
        available,
        status,
    )

    assert [f["b64_data"] for f in resolved] == ["version-1", "version-2"]


def test_reference_to_step_from_other_request_is_rejected():
    # Registry is empty (nothing produced in this request); step 2 only exists in history.
    with pytest.raises(GeneratedFileReferenceError) as exc:
        resolve_generated_file_references(
            [{"filename": "data.csv", "source_step": 2}], available_files=[], step_status={}
        )
    assert "step 2" in str(exc.value)
    assert "current research request" in str(exc.value).lower()


def test_reference_to_failed_step_is_rejected():
    status = {2: make_step_status(success=False, warning="sandbox exploded", files=[])}
    with pytest.raises(GeneratedFileReferenceError) as exc:
        resolve_generated_file_references(
            [{"filename": "data.csv", "source_step": 2}], available_files=[], step_status=status
        )
    assert "failed" in str(exc.value)
    assert "sandbox exploded" in str(exc.value)


def test_reference_to_non_code_step_is_rejected():
    status = {1: make_step_status(name=ConversationCommand.SearchWeb.value, success=True)}
    with pytest.raises(GeneratedFileReferenceError) as exc:
        resolve_generated_file_references(
            [{"filename": "data.csv", "source_step": 1}], available_files=[], step_status=status
        )
    assert "search_web" in str(exc.value)


def test_reference_to_missing_filename_lists_available_files():
    available = [GeneratedFile(source_step=2, filename="a.csv", b64_data="x")]
    status = {2: make_step_status(success=True, files=["a.csv"])}
    with pytest.raises(GeneratedFileReferenceError) as exc:
        resolve_generated_file_references(
            [{"filename": "b.csv", "source_step": 2}], available_files=available, step_status=status
        )
    assert '"a.csv"' in str(exc.value)


@pytest.mark.parametrize(
    "bad_reference",
    [
        {"filename": "a.csv"},  # missing source_step
        {"source_step": 2},  # missing filename
        {"filename": "a.csv", "source_step": "2"},  # step must be int
        {"filename": "", "source_step": 2},  # blank filename
        "not-a-dict",
    ],
)
def test_malformed_references_are_rejected(bad_reference):
    with pytest.raises(GeneratedFileReferenceError):
        resolve_generated_file_references([bad_reference], [], {})


def test_no_selection_resolves_nothing():
    assert resolve_generated_file_references(None, [], {}) == []
    assert resolve_generated_file_references(None, [GeneratedFile(1, "a", "b")], {1: make_step_status()}) == []


def test_empty_selection_list_is_rejected():
    with pytest.raises(GeneratedFileReferenceError):
        resolve_generated_file_references([], [], {})


# ---------------------------------------------------------------------------
# collision-free sandbox aliases and full-content encoding
# ---------------------------------------------------------------------------


def test_same_named_files_get_distinct_aliases():
    selected = [
        {"source_step": 2, "filename": "out.csv", "b64_data": "v1"},
        {"source_step": 4, "filename": "out.csv", "b64_data": "v2"},
    ]
    aliased = assign_generated_file_aliases(selected, reserved_user_filenames=set())

    aliases = {f["sandbox_filename"] for f in aliased}
    assert len(aliases) == 2
    assert "out.csv" in aliases


def test_alias_never_overwrites_indexed_user_file():
    selected = [{"source_step": 2, "filename": "notes.md", "b64_data": "generated"}]
    aliased = assign_generated_file_aliases(selected, reserved_user_filenames={"notes.md"})

    assert aliased[0]["sandbox_filename"] != "notes.md"
    assert aliased[0]["sandbox_filename"].endswith(".md")


def test_alias_never_overwrites_user_file_with_full_path():
    selected = [{"source_step": 2, "filename": "data.csv", "b64_data": "x"}]
    aliased = assign_generated_file_aliases(selected, reserved_user_filenames={"/home/khoj/docs/data.csv"})
    assert aliased[0]["sandbox_filename"] != "data.csv"


def test_all_aliases_are_unique_even_with_step_prefix_collision():
    selected = [
        {"source_step": 2, "filename": "r.csv", "b64_data": "a"},
        {"source_step": 3, "filename": "r.csv", "b64_data": "b"},
        {"source_step": 4, "filename": "r_step2.csv", "b64_data": "c"},
    ]
    # Reserve "r.csv" as an indexed user file and "r_step2.csv" too, forcing numbered dedupe.
    aliased = assign_generated_file_aliases(selected, reserved_user_filenames={"r.csv", "r_step2.csv", "r_step3.csv"})
    aliases = [f["sandbox_filename"] for f in aliased]
    assert len(set(aliases)) == len(aliases)
    assert not {"r.csv", "r_step2.csv", "r_step3.csv"} & set(aliases)


def test_text_file_encoded_as_base64_of_full_content():
    payload = "line1\nline2\n" * 100
    encoded = encode_generated_file_for_sandbox(
        {"filename": "full.txt", "sandbox_filename": "full.txt", "b64_data": payload}
    )
    assert encoded["filename"] == "full.txt"
    assert base64.b64decode(encoded["b64_data"]).decode("utf-8") == payload


def test_image_file_b64_passes_through_unchanged():
    image_b64 = base64.b64encode(b"\xff\xd8\xff\xe0jpeg").decode("utf-8")
    encoded = encode_generated_file_for_sandbox(
        {"filename": "chart.png", "sandbox_filename": "plot.png", "b64_data": image_b64}
    )
    assert encoded == {"filename": "plot.png", "b64_data": image_b64}


def test_generated_files_context_mentions_exact_aliases_and_steps():
    context = build_generated_files_context(
        [
            {"source_step": 2, "filename": "a.csv", "sandbox_filename": "a.csv", "b64_data": "x"},
            {"source_step": 3, "filename": "a.csv", "sandbox_filename": "a_step3.csv", "b64_data": "y"},
        ]
    )
    assert '"a.csv"' in context
    assert '"a_step3.csv"' in context
    assert "step 2" in context
    assert "step 3" in context
    assert "image" not in context.split("a.csv")[0]  # csv described as text


def test_planner_listing_groups_files_by_step():
    listing = format_generated_files_for_planning(
        [
            GeneratedFile(2, "a.csv", "x"),
            GeneratedFile(3, "p.png", base64.b64encode(b"img").decode("utf-8")),
        ]
    )
    assert 'Step 2: "a.csv" (text)' in listing
    assert 'Step 3: "p.png" (image)' in listing
    assert "input_files" in listing


def test_empty_planner_listing_is_blank():
    assert format_generated_files_for_planning([]) == ""


# ---------------------------------------------------------------------------
# record_completed_step registry behavior
# ---------------------------------------------------------------------------


def test_record_registers_files_only_from_successful_code_steps():
    output = [{"filename": "data.csv", "b64_data": "full,untruncated,content"}]
    iteration = ResearchIteration(
        query=ToolCall(name=ConversationCommand.PythonCoder, args={"instructions": "do"}, id="1")
    )
    tool_result = ToolExecutionResult()
    tool_result.code_results = {"do": {"code": "print(1)", "results": {"success": True, "output_files": output}}}
    generated_files = []
    step_status = {}

    record_completed_step(iteration, tool_result, 2, generated_files, step_status)

    assert generated_files == [GeneratedFile(2, "data.csv", "full,untruncated,content")]
    assert step_status[2]["success"] is True


def test_record_does_not_register_files_from_failed_code_steps():
    iteration = ResearchIteration(
        query=ToolCall(name=ConversationCommand.PythonCoder, args={"instructions": "do"}, id="1"),
        warning="Error executing run_code: boom",
    )
    tool_result = ToolExecutionResult()
    tool_result.code_results = {
        "do": {"code": "x", "results": {"success": False, "output_files": [{"filename": "a.csv", "b64_data": "z"}]}}
    }
    generated_files = []
    step_status = {}

    record_completed_step(iteration, tool_result, 2, generated_files, step_status)

    assert generated_files == []
    assert step_status[2]["success"] is False
    assert step_status[2]["files"] == ["a.csv"]


def test_record_non_code_step_has_no_selectable_files():
    iteration = ResearchIteration(query=ToolCall(name=ConversationCommand.SearchWeb, args={"query": "weather"}, id="1"))
    tool_result = ToolExecutionResult()
    generated_files = []
    step_status = {}

    record_completed_step(iteration, tool_result, 1, generated_files, step_status)

    assert generated_files == []
    assert step_status[1]["name"] == ConversationCommand.SearchWeb.value


# ---------------------------------------------------------------------------
# execute_tool integration: invalid references skip code execution
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_tool_invalid_reference_does_not_run_code(monkeypatch):
    async def fail_if_called(*args, **kwargs):
        raise AssertionError("run_code must not be invoked for invalid generated file references")
        yield  # pragma: no cover

    monkeypatch.setattr("khoj.routers.research.run_code", fail_if_called)

    iteration = ResearchIteration(
        query=ToolCall(
            name=ConversationCommand.PythonCoder,
            args={
                "instructions": "reuse a file",
                "input_files": [{"filename": "ghost.csv", "source_step": 9}],
            },
            id="call-1",
        )
    )

    result = await execute_tool(
        iteration=iteration,
        user=None,
        conversation_id="c1",
        previous_iterations=[],
        location=None,
        query_images=[],
        query_files=None,
        max_document_searches=7,
        max_online_searches=3,
        mcp_clients=[],
        cancellation_event=None,
        interrupt_queue=None,
        agent=None,
        tracer={},
        generated_files=[],
        run_step_status={},
    )

    assert result.code_results == {}
    assert iteration.warning is not None
    assert "ghost.csv" in iteration.warning
    assert "step 9" in iteration.warning


@pytest.mark.asyncio
async def test_execute_tool_passes_resolved_files_to_run_code(monkeypatch):
    captured = {}

    async def fake_run_code(instructions, **kwargs):
        captured["instructions"] = instructions
        captured["generated_input_files"] = kwargs["generated_input_files"]
        assert "input_files" not in kwargs  # planner arg must be stripped
        yield {instructions: {"code": "1", "results": {"success": True}}}

    monkeypatch.setattr("khoj.routers.research.run_code", fake_run_code)

    full_text = "hello,world\n1,2\n"
    iteration = ResearchIteration(
        query=ToolCall(
            name=ConversationCommand.PythonCoder,
            args={
                "instructions": "reuse",
                "input_files": [{"filename": "data.csv", "source_step": 2}],
            },
            id="call-2",
        )
    )

    await execute_tool(
        iteration=iteration,
        user=None,
        conversation_id="c1",
        previous_iterations=[],
        location=None,
        query_images=[],
        query_files=None,
        max_document_searches=7,
        max_online_searches=3,
        mcp_clients=[],
        cancellation_event=None,
        interrupt_queue=None,
        agent=None,
        tracer={},
        generated_files=[GeneratedFile(2, "data.csv", full_text)],
        run_step_status={2: make_step_status(success=True, files=["data.csv"])},
    )

    assert captured["instructions"] == "reuse"
    assert len(captured["generated_input_files"]) == 1
    assert captured["generated_input_files"][0]["filename"] == "data.csv"
    assert captured["generated_input_files"][0]["b64_data"] == full_text
    assert iteration.codeContext is not None


# ---------------------------------------------------------------------------
# run_code end-to-end wiring (code generation + sandbox input assembly)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_run_code_uploads_selected_files_with_full_content(monkeypatch):
    from khoj.processor.tools import run_code as run_code_module

    full_text = "a,b\n1,2\n"
    image_b64 = base64.b64encode(b"png-bytes").decode("utf-8")
    captured_prompt = {}
    captured_input = {}

    async def fake_model_call(prompt, **kwargs):
        captured_prompt["text"] = prompt
        # Code references an indexed user file by its full path.
        return SimpleNamespace(text="```python\nprint(open('/sync/notes.md').read())\n```")

    def fake_get_all_file_objects(user):
        return [SimpleNamespace(file_name="/sync/notes.md", raw_text="indexed notes")]

    async def fake_execute(code, input_data, sandbox_url=None):
        captured_input["data"] = input_data
        return {"code": code, "success": True, "std_out": "", "std_err": "", "output_files": []}

    monkeypatch.setattr(run_code_module, "send_message_to_model_wrapper", fake_model_call)
    monkeypatch.setattr(run_code_module.FileObjectAdapters, "get_all_file_objects", fake_get_all_file_objects)
    monkeypatch.setattr(run_code_module, "execute_sandboxed_python", fake_execute)

    user = SimpleNamespace(get_full_name=lambda: "")
    results = []
    async for event in run_code_module.run_code(
        instructions="analyze generated files",
        conversation_history=[],
        context="",
        location_data=None,
        user=user,
        generated_input_files=[
            {"source_step": 2, "filename": "data.csv", "b64_data": full_text},
            {"source_step": 3, "filename": "chart.png", "b64_data": image_b64},
        ],
    ):
        if not (isinstance(event, dict) and "status" in event):
            results.append(event)

    assert results, "run_code should yield its execution result"

    by_name = {f["filename"]: f["b64_data"] for f in captured_input["data"]}
    # Indexed user file still uploaded under its basename with full content.
    assert base64.b64decode(by_name["notes.md"]).decode("utf-8") == "indexed notes"
    # Generated text file: full original content, not truncated.
    assert base64.b64decode(by_name["data.csv"]).decode("utf-8") == full_text
    # Generated image: original base64 passed through intact.
    assert by_name["chart.png"] == image_b64
    # Every sandbox filename is unique.
    assert len(by_name) == len(captured_input["data"])
    # Code generation prompt tells the coder exactly which files are available.
    assert "data.csv" in captured_prompt["text"]
    assert "chart.png" in captured_prompt["text"]


@pytest.mark.asyncio
async def test_run_code_without_selection_keeps_original_behavior(monkeypatch):
    from khoj.processor.tools import run_code as run_code_module

    captured_input = {}

    async def fake_model_call(prompt, **kwargs):
        assert "Files Available" not in prompt
        return SimpleNamespace(text="```python\nprint('hi')\n```")

    def fake_get_all_file_objects(user):
        return []

    async def fake_execute(code, input_data, sandbox_url=None):
        captured_input["data"] = input_data
        return {"code": code, "success": True, "std_out": "", "std_err": "", "output_files": []}

    monkeypatch.setattr(run_code_module, "send_message_to_model_wrapper", fake_model_call)
    monkeypatch.setattr(run_code_module.FileObjectAdapters, "get_all_file_objects", fake_get_all_file_objects)
    monkeypatch.setattr(run_code_module, "execute_sandboxed_python", fake_execute)

    user = SimpleNamespace(get_full_name=lambda: "")
    async for _ in run_code_module.run_code(
        instructions="just calculate",
        conversation_history=[],
        context="",
        location_data=None,
        user=user,
    ):
        pass

    assert captured_input["data"] == []
