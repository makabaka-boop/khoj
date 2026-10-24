"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CaretUp, Check, Copy, Share, Spinner } from "@phosphor-icons/react";

import ChatMessage, {
    ChatHistoryData,
    SingleChatMessage,
    TrainOfThoughtObject,
} from "../chatMessage/chatMessage";
import { TrainOfThoughtComponent } from "../chatHistory/chatHistory";
import { useIsMobileWidth } from "@/app/common/utils";

const PAGE_SIZE = 10;

interface ShareChatDialogProps {
    conversationId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

type ShareMode = "choose" | "select" | "done";

interface TurnGroup {
    token: string;
    selectable: boolean;
}

function postShare(conversationId: string, turns?: string[]) {
    return fetch(`/api/chat/share?client=web&conversation_id=${conversationId}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: turns !== undefined ? JSON.stringify({ turns }) : undefined,
    });
}

export default function ShareChatDialog(props: ShareChatDialogProps) {
    const isMobileWidth = useIsMobileWidth();
    const [mode, setMode] = useState<ShareMode>("choose");
    const [history, setHistory] = useState<ChatHistoryData | null>(null);
    const [fetchedCount, setFetchedCount] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [creatingShare, setCreatingShare] = useState(false);
    const [sharingWhole, setSharingWhole] = useState(false);
    const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
    const [previewOnly, setPreviewOnly] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [shareUrl, setShareUrl] = useState("");
    const [copied, setCopied] = useState(false);

    const resetState = useCallback(() => {
        setMode("choose");
        setHistory(null);
        setFetchedCount(0);
        setHasMore(true);
        setLoadingHistory(false);
        setCreatingShare(false);
        setSharingWhole(false);
        setSelectedTokens(new Set());
        setPreviewOnly(false);
        setErrorMessage("");
        setShareUrl("");
        setCopied(false);
    }, []);

    useEffect(() => {
        if (!props.open) {
            // Reset after the close animation so the next open starts clean.
            const timer = setTimeout(resetState, 200);
            return () => clearTimeout(timer);
        }
    }, [props.open, resetState]);

    // Flatten messages into turns using the backend-provided shareToken.
    const messages = useMemo(() => history?.chat ?? [], [history]);
    const turns = useMemo<TurnGroup[]>(() => {
        const result: TurnGroup[] = [];
        let previousToken: string | null = null;
        messages.forEach((message, index) => {
            const token = message.shareToken || `fallback-${index}`;
            if (token !== previousToken) {
                result.push({ token, selectable: message.turnSelectable ?? false });
                previousToken = token;
            }
        });
        return result;
    }, [messages]);
    // Message indices at which a turn group starts (checkbox anchor).
    const groupStartIndices = useMemo(() => {
        const starts = new Set<number>();
        let previousToken: string | null = null;
        messages.forEach((message, index) => {
            const token = message.shareToken || `fallback-${index}`;
            if (token !== previousToken) {
                starts.add(index);
                previousToken = token;
            }
        });
        return starts;
    }, [messages]);
    const turnByToken = useMemo(() => new Map(turns.map((turn) => [turn.token, turn])), [turns]);

    const fetchHistory = useCallback(
        async (count: number, previousLength: number) => {
            setLoadingHistory(true);
            setErrorMessage("");
            try {
                const response = await fetch(
                    `/api/chat/history?client=web&conversation_id=${encodeURIComponent(props.conversationId)}&n=${count}`,
                );
                const payload = await response.json();
                if (!response.ok || payload.status !== "ok") {
                    setErrorMessage(payload.message || "Failed to load conversation messages.");
                    return;
                }
                const nextHistory = payload.response as ChatHistoryData;
                setHistory(nextHistory);
                const messageCount = nextHistory.chat?.length ?? 0;
                // Stop paging once the whole conversation is loaded or a page added nothing.
                if (messageCount < count || messageCount === previousLength) {
                    setHasMore(false);
                }
            } catch (error) {
                console.error(error);
                setErrorMessage("Failed to load conversation messages.");
            } finally {
                setLoadingHistory(false);
            }
        },
        [props.conversationId],
    );

    const enterSelectMode = useCallback(async () => {
        setMode("select");
        setErrorMessage("");
        setFetchedCount(PAGE_SIZE);
        await fetchHistory(PAGE_SIZE, 0);
    }, [fetchHistory]);

    const loadEarlier = useCallback(async () => {
        const nextCount = fetchedCount + PAGE_SIZE;
        const previousLength = messages.length;
        setFetchedCount(nextCount);
        await fetchHistory(nextCount, previousLength);
    }, [fetchedCount, fetchHistory, messages.length]);

    const orderedSelectedTokens = useMemo(() => {
        return turns.map((turn) => turn.token).filter((token) => selectedTokens.has(token));
    }, [turns, selectedTokens]);

    const toggleTurn = (token: string, checked: boolean) => {
        setErrorMessage("");
        setSelectedTokens((previous) => {
            const next = new Set(previous);
            if (checked) {
                next.add(token);
            } else {
                next.delete(token);
            }
            return next;
        });
    };

    const handleShareWhole = async () => {
        setSharingWhole(true);
        setErrorMessage("");
        try {
            const response = await postShare(props.conversationId);
            const payload = await response.json();
            if (!response.ok || payload.status !== "ok") {
                setErrorMessage(payload.message || "Failed to share the conversation.");
                setSharingWhole(false);
                return;
            }
            navigator.clipboard?.writeText(payload.url);
            setShareUrl(payload.url);
            setMode("done");
        } catch (error) {
            console.error(error);
            setErrorMessage("Failed to share the conversation.");
        } finally {
            setSharingWhole(false);
        }
    };

    const handleShareSelected = async () => {
        if (orderedSelectedTokens.length === 0) return;
        setCreatingShare(true);
        setErrorMessage("");
        try {
            const response = await postShare(props.conversationId, orderedSelectedTokens);
            const payload = await response.json();
            if (!response.ok || payload.status !== "ok") {
                // e.g. selected turns were deleted/changed while the dialog was open.
                setErrorMessage(payload.message || "Failed to share the selected Q&A.");
                setCreatingShare(false);
                return;
            }
            navigator.clipboard?.writeText(payload.url);
            setShareUrl(payload.url);
            setMode("done");
        } catch (error) {
            console.error(error);
            setErrorMessage("Failed to share the selected Q&A.");
            setCreatingShare(false);
        }
    };

    const toChatMessage = (message: SingleChatMessage): SingleChatMessage => ({
        ...message,
        automationId: message.automationId ?? "",
        context: message.context ?? [],
        onlineContext: message.onlineContext ?? {},
        codeContext: message.codeContext ?? {},
        conversationId: props.conversationId,
    });

    const renderMessage = (message: SingleChatMessage, index: number) => {
        const token = message.shareToken || `fallback-${index}`;
        const turn = turnByToken.get(token);
        const isGroupStart = groupStartIndices.has(index);
        const isSelected = selectedTokens.has(token);
        const showSelectionUi = mode === "select" && !previewOnly;

        // The checkbox sits on the first message of each turn (typically the user question);
        // continuation messages keep an empty spacer so all rows stay aligned.
        const checkboxCell =
            showSelectionUi &&
            (isGroupStart ? (
                <div className="flex items-start pt-1 pr-2">
                    {turn?.selectable ? (
                        <Checkbox
                            checked={isSelected}
                            onCheckedChange={(checked) => toggleTurn(token, checked === true)}
                            aria-label="Select this Q&A turn"
                        />
                    ) : (
                        <Checkbox disabled aria-label="Incomplete turn" />
                    )}
                </div>
            ) : (
                <div className="w-4 pr-2" />
            ));

        const incompleteLabel =
            showSelectionUi && isGroupStart && turn && !turn.selectable ? (
                <div className="text-xs text-muted-foreground italic pl-10">
                    Incomplete turn (missing question or answer) — cannot be shared
                </div>
            ) : null;

        return (
            <div key={`share-msg-${index}`}>
                {incompleteLabel}
                <div
                    className={`flex flex-row rounded-lg px-1 ${
                        showSelectionUi && isSelected ? "bg-accent/60" : ""
                    }`}
                >
                    {checkboxCell}
                    <div className="flex-1 min-w-0">
                        {message.by === "khoj" &&
                            message.trainOfThought &&
                            message.trainOfThought.length > 0 && (
                                <TrainOfThoughtComponent
                                    trainOfThought={
                                        message.trainOfThought as TrainOfThoughtObject[]
                                    }
                                    lastMessage={false}
                                    agentColor="orange"
                                    keyId={`${index}-trainOfThought`}
                                    completed={true}
                                />
                            )}
                        <ChatMessage
                            chatMessage={toChatMessage(message)}
                            isMobileWidth={isMobileWidth}
                            customClassName="fullHistory"
                            isLastMessage={false}
                            onDeleteMessage={() => {}}
                            conversationId={props.conversationId}
                            readOnly={true}
                        />
                    </div>
                </div>
            </div>
        );
    };

    const visibleMessages = useMemo(() => {
        if (mode !== "select" || !previewOnly) return messages;
        return messages.filter((message) => selectedTokens.has(message.shareToken || ""));
    }, [mode, previewOnly, messages, selectedTokens]);

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {mode === "done" ? "Conversation share link" : "Share conversation"}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === "choose" &&
                            "Share the whole conversation, or pick only specific Q&A turns to make public."}
                        {mode === "select" &&
                            (previewOnly
                                ? "Preview of the selected Q&A. References, attachments and tool results are included."
                                : "Choose the complete Q&A turns to share. You can select non-contiguous turns.")}
                        {mode === "done" &&
                            "Anyone with this link can view the shared snapshot. Later messages in this conversation are not added to it."}
                    </DialogDescription>
                </DialogHeader>

                {mode === "choose" && (
                    <div className="flex flex-col gap-3 py-2">
                        <Button
                            variant="outline"
                            className="justify-start h-auto py-3"
                            onClick={handleShareWhole}
                            disabled={sharingWhole}
                        >
                            {sharingWhole ? (
                                <Spinner className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Share className="mr-2 h-4 w-4" />
                            )}
                            <div className="text-left">
                                <div className="font-semibold">Share entire conversation</div>
                                <div className="text-xs text-muted-foreground font-normal">
                                    Publish every message in this conversation.
                                </div>
                            </div>
                        </Button>
                        <Button
                            variant="outline"
                            className="justify-start h-auto py-3"
                            onClick={enterSelectMode}
                        >
                            <Check className="mr-2 h-4 w-4" />
                            <div className="text-left">
                                <div className="font-semibold">Select Q&amp;A to share</div>
                                <div className="text-xs text-muted-foreground font-normal">
                                    Load earlier messages and hand-pick the turns to publish.
                                </div>
                            </div>
                        </Button>
                    </div>
                )}

                {mode === "select" && (
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPreviewOnly(!previewOnly)}
                                disabled={selectedTokens.size === 0 && !previewOnly}
                            >
                                {previewOnly
                                    ? "Back to selection"
                                    : `Preview selected (${selectedTokens.size})`}
                            </Button>
                            {!previewOnly && hasMore && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={loadEarlier}
                                    disabled={loadingHistory}
                                >
                                    {loadingHistory ? (
                                        <Spinner className="mr-1 h-4 w-4 animate-spin" />
                                    ) : (
                                        <CaretUp className="mr-1 h-4 w-4" />
                                    )}
                                    Load earlier messages
                                </Button>
                            )}
                        </div>
                        <ScrollArea className="h-[55vh] pr-3">
                            {loadingHistory && history === null ? (
                                <div className="flex justify-center py-8">
                                    <Spinner className="h-6 w-6 animate-spin" />
                                </div>
                            ) : visibleMessages.length === 0 ? (
                                <div className="text-center text-muted-foreground py-8 text-sm">
                                    {previewOnly
                                        ? "No turns selected yet."
                                        : "No messages available to share."}
                                </div>
                            ) : (
                                <div className="flex flex-col gap-1">
                                    {!previewOnly &&
                                        messages.map((message, index) =>
                                            renderMessage(message, index),
                                        )}
                                    {previewOnly &&
                                        visibleMessages.map((message, index) => {
                                            const originalIndex = messages.indexOf(message);
                                            return renderMessage(
                                                message,
                                                originalIndex >= 0 ? originalIndex : index,
                                            );
                                        })}
                                </div>
                            )}
                        </ScrollArea>
                    </div>
                )}

                {mode === "done" && (
                    <div className="flex items-center space-x-2 py-2">
                        <div className="grid flex-1 gap-2">
                            <Input value={shareUrl} readOnly aria-label="Share link" />
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            className="px-3"
                            onClick={() => {
                                navigator.clipboard?.writeText(shareUrl);
                                setCopied(true);
                            }}
                        >
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
                        </Button>
                    </div>
                )}

                {errorMessage && (
                    <div className="text-sm text-rose-500 break-words" role="alert">
                        {errorMessage}
                    </div>
                )}

                {mode === "select" && (
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
                            Cancel
                        </Button>
                        {!previewOnly && (
                            <Button
                                onClick={handleShareSelected}
                                disabled={selectedTokens.size === 0 || creatingShare}
                            >
                                {creatingShare && <Spinner className="mr-2 h-4 w-4 animate-spin" />}
                                Share {selectedTokens.size > 0 ? `${selectedTokens.size} Q&A` : ""}
                            </Button>
                        )}
                    </DialogFooter>
                )}
                {mode === "done" && (
                    <DialogFooter>
                        <Button onClick={() => props.onOpenChange(false)}>Done</Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
