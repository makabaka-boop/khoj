"use client";

import { Input } from "@/components/ui/input";

import { useEffect, useRef, useState } from "react";
import styles from "./search.module.css";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    ArrowLeft,
    ArrowRight,
    ArrowsClockwise,
    CaretDown,
    CaretUp,
    FileDashed,
    Files,
    GithubLogo,
    Lightbulb,
    LinkSimple,
    ListBullets,
    MagnifyingGlass,
    NoteBlank,
    NotionLogo,
    Trash,
    DotsThreeVertical,
    Waveform,
    Plus,
    Download,
    Brain,
    Check,
    BoxArrowDown,
    Funnel,
    WarningCircle,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { formatDateTime, useIsMobileWidth } from "../common/utils";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "../components/appSidebar/appSidebar";
import { Separator } from "@/components/ui/separator";
import { KhojLogoType } from "../components/logo/khojLogo";
import { InlineLoading } from "../components/loading/loading";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";

import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { uploadDataForIndexing } from "../common/chatFunctions";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
interface AdditionalData {
    file: string;
    source: string;
    compiled: string;
    heading: string;
    uri?: string;
}

interface SearchResult {
    type: string;
    additional: AdditionalData;
    entry: string;
    score: number;
    "corpus-id": string;
}

interface DocumentSearchResult {
    best: SearchResult;
}

type SearchViewMode = "documents" | "snippets";

interface ExpandedDocumentState {
    status: "loading" | "error" | "loaded";
    paragraphs: SearchResult[];
}

function getDocumentKey(additional: AdditionalData): string {
    // Same-named files from different sources or paths are distinct documents
    return `${additional.source || ""}::${additional.file || ""}`;
}

function getDisplayFileName(additional: AdditionalData): string {
    const isFileNameURL = (additional.file || "").startsWith("http");
    return isFileNameURL ? additional.heading : additional.file.split("/").pop() || additional.file;
}

interface FileObject {
    file_name: string;
    raw_text: string;
    updated_at: string;
}

function getNoteTypeIcon(source: string) {
    if (source === "notion") {
        return <NotionLogo className="text-muted-foreground" />;
    }
    if (source === "github") {
        return <GithubLogo className="text-muted-foreground" />;
    }
    return <NoteBlank className="text-muted-foreground" />;
}

interface FileCardProps {
    file: FileObject;
    index: number;
    setSelectedFile: (file: string) => void;
    setSelectedFileFullText: (file: string) => void;
    handleDownload: (fileName: string, content: string) => void;
    handleDelete: (fileName: string) => void;
    isDeleting: boolean;
    selectedFileFullText: string | null;
}

function FileCard({
    file,
    setSelectedFile,
    setSelectedFileFullText,
    handleDownload,
    handleDelete,
    isDeleting,
    selectedFileFullText,
}: FileCardProps) {
    return (
        <Card className="animate-fade-in-up bg-secondary h-52">
            <CardHeader className="p-2">
                <CardTitle
                    className="flex items-center gap-2 justify-between"
                    title={file.file_name}
                >
                    <Dialog>
                        <DialogTrigger asChild>
                            <div
                                className="text-sm font-medium truncate hover:text-clip hover:whitespace-normal cursor-pointer"
                                onClick={() => {
                                    setSelectedFileFullText("");
                                    setSelectedFile(file.file_name);
                                }}
                            >
                                {file.file_name.split("/").pop()}
                            </div>
                        </DialogTrigger>
                        <DialogContent className="max-w-fit">
                            <DialogHeader>
                                <DialogTitle>
                                    <div className="flex items-center gap-2">
                                        {file.file_name.split("/").pop()}
                                        <Button
                                            variant={"ghost"}
                                            title="Download as plaintext"
                                            onClick={() =>
                                                handleDownload(file.file_name, file.raw_text)
                                            }
                                        >
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </DialogTitle>
                            </DialogHeader>
                            <ScrollArea className="h-[50vh] w-[80vw]">
                                <p className="whitespace-pre-wrap break-words text-sm font-normal word-wrap">
                                    {!selectedFileFullText && (
                                        <InlineLoading
                                            className="mt-4"
                                            message={"Loading"}
                                            iconClassName="h-5 w-5"
                                        />
                                    )}
                                    {selectedFileFullText}
                                </p>
                            </ScrollArea>
                        </DialogContent>
                    </Dialog>
                    <DropdownMenu>
                        <DropdownMenuTrigger>
                            <Button variant={"ghost"}>
                                <DotsThreeVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="flex flex-col gap-0 w-fit">
                            <DropdownMenuItem className="p-0">
                                <Button
                                    variant={"ghost"}
                                    className="flex items-center gap-2 p-1 text-sm"
                                    onClick={() => {
                                        handleDelete(file.file_name);
                                    }}
                                >
                                    <Trash className="h-4 w-4" />
                                    <span className="text-xs">
                                        {isDeleting ? "Deleting..." : "Delete"}
                                    </span>
                                </Button>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </CardTitle>
            </CardHeader>
            <CardContent className="p-2">
                <ScrollArea className="h-24 bg-background rounded-lg">
                    <p className="whitespace-pre-wrap break-words text-sm font-normal text-muted-foreground p-2 h-full">
                        {file.raw_text.slice(0, 100)}...
                    </p>
                </ScrollArea>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 p-2">
                <div className="text-muted-foreground text-xs">
                    {formatDateTime(file.updated_at)}
                </div>
            </CardFooter>
        </Card>
    );
}

interface NoteResultProps {
    note: SearchResult;
    setFocusSearchResult: (note: SearchResult) => void;
}

function Note(props: NoteResultProps) {
    const note = props.note;
    const isFileNameURL = (note.additional.file || "").startsWith("http");
    const fileName = isFileNameURL
        ? note.additional.heading
        : note.additional.file.split("/").pop();

    return (
        <Card className="bg-secondary h-full shadow-sm rounded-lg border border-muted mb-4 animate-fade-in-up">
            <CardHeader>
                <CardTitle className="inline-flex gap-2">
                    {getNoteTypeIcon(note.additional.source)}
                    {fileName}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="line-clamp-4 text-muted-foreground">{note.entry}</div>
                <Button
                    onClick={() => props.setFocusSearchResult(note)}
                    variant={"ghost"}
                    className="p-0 mt-2 text-orange-400 hover:bg-inherit"
                >
                    See content
                    <ArrowRight className="inline ml-2" />
                </Button>
            </CardContent>
            {isFileNameURL && (
                <CardFooter>
                    <a
                        href={note.additional.file}
                        target="_blank"
                        className="underline text-sm bg-muted p-1 rounded-lg text-muted-foreground"
                    >
                        <LinkSimple className="inline m-2" />
                        {note.additional.file}
                    </a>
                </CardFooter>
            )}
        </Card>
    );
}

function focusNote(note: SearchResult) {
    const isFileNameURL = (note.additional.file || "").startsWith("http");
    const fileName = isFileNameURL
        ? note.additional.heading
        : note.additional.file.split("/").pop();

    return (
        <Card className="bg-secondary h-full shadow-sm rounded-lg border border-muted mb-4 animate-fade-in-up">
            <CardHeader>
                <CardTitle>{fileName}</CardTitle>
            </CardHeader>
            {isFileNameURL && (
                <CardFooter>
                    <a
                        href={note.additional.file}
                        target="_blank"
                        className="underline text-sm bg-muted p-3 rounded-lg text-muted-foreground flex items-center gap-2"
                    >
                        <LinkSimple className="inline" />
                        {note.additional.file}
                    </a>
                </CardFooter>
            )}
            <CardContent>
                <div className="text-m">{note.entry}</div>
            </CardContent>
        </Card>
    );
}

interface DocumentCardProps {
    document: DocumentSearchResult;
    expandedState?: ExpandedDocumentState;
    onToggleExpand: () => void;
    onRetry: () => void;
}

function DocumentCard({ document, expandedState, onToggleExpand, onRetry }: DocumentCardProps) {
    const best = document.best;
    const additional = best.additional;
    const isFileNameURL = (additional.file || "").startsWith("http");
    const displayName = getDisplayFileName(additional);
    // Per-paragraph links take precedence; fall back to the document URL
    const documentLink = additional.uri || (isFileNameURL ? additional.file : null);
    const isExpanded = expandedState !== undefined;

    return (
        <Card className="bg-secondary h-full shadow-sm rounded-lg border border-muted mb-4 animate-fade-in-up">
            <CardHeader>
                <CardTitle className="flex items-start gap-2" title={additional.file}>
                    {getNoteTypeIcon(additional.source)}
                    <div className="min-w-0 flex-1">
                        <div className="truncate">{displayName}</div>
                        {!isFileNameURL && additional.file && additional.file !== displayName && (
                            <div className="text-xs font-normal text-muted-foreground truncate">
                                {additional.file}
                            </div>
                        )}
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {!isExpanded && (
                    <div className="line-clamp-4 text-muted-foreground whitespace-pre-wrap break-words">
                        {best.entry}
                    </div>
                )}
                {documentLink && !isExpanded && (
                    <a
                        href={documentLink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block underline text-sm bg-muted p-1 rounded-lg text-muted-foreground break-all"
                    >
                        <LinkSimple className="inline m-2" />
                        {documentLink}
                    </a>
                )}
                <Button
                    onClick={onToggleExpand}
                    variant={"ghost"}
                    className="p-0 mt-2 text-orange-400 hover:bg-inherit"
                >
                    {isExpanded ? (
                        <>
                            Hide matching sections
                            <CaretUp className="inline ml-2" />
                        </>
                    ) : (
                        <>
                            Show matching sections
                            <CaretDown className="inline ml-2" />
                        </>
                    )}
                </Button>
                {isExpanded && (
                    <div className="mt-3 pt-3 border-t flex flex-col gap-3">
                        {expandedState.status === "loading" && (
                            <InlineLoading message={"Loading sections"} iconClassName="h-4 w-4" />
                        )}
                        {expandedState.status === "error" && (
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-sm text-red-500 inline-flex items-center gap-1">
                                    <WarningCircle className="h-4 w-4" />
                                    Failed to load matching sections.
                                </span>
                                <Button variant={"outline"} size="sm" onClick={onRetry}>
                                    <ArrowsClockwise className="h-4 w-4 mr-1" />
                                    Retry
                                </Button>
                            </div>
                        )}
                        {expandedState.status === "loaded" &&
                            expandedState.paragraphs.length === 0 && (
                                <div className="text-sm text-muted-foreground">
                                    No additional matching sections found in this document.
                                </div>
                            )}
                        {expandedState.status === "loaded" &&
                            expandedState.paragraphs.map((paragraph) => {
                                const paragraphLink = paragraph.additional.uri;
                                return (
                                    <div
                                        key={paragraph["corpus-id"]}
                                        className="rounded-lg bg-background p-2 border border-muted"
                                    >
                                        {paragraph.additional.heading && (
                                            <div className="text-sm font-medium mb-1 break-words">
                                                {paragraph.additional.heading}
                                            </div>
                                        )}
                                        <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
                                            {paragraph.entry}
                                        </div>
                                        {paragraphLink && (
                                            <a
                                                href={paragraphLink}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="mt-1 inline-block underline text-xs bg-muted p-1 rounded-lg text-muted-foreground break-all"
                                            >
                                                <LinkSimple className="inline m-1" />
                                                {paragraphLink}
                                            </a>
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function EmptySearchResults({ query }: { query: string }) {
    return (
        <Card className="mt-4 flex flex-col items-center justify-center border-none shadow-none">
            <CardHeader className="flex flex-col items-center justify-center">
                <CardDescription className="border-muted-foreground border w-fit rounded-lg mb-2 text-center text-lg p-4">
                    <MagnifyingGlass weight="fill" className="text-muted-foreground h-10 w-10" />
                </CardDescription>
                <CardTitle className="text-center">No results found</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-muted-foreground items-center justify-center text-center flex">
                    No documents matched &quot;{query}&quot;. Try different keywords or clear your
                    filters.
                </div>
            </CardContent>
        </Card>
    );
}

function SearchErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <Card className="mt-4 border-red-300">
            <CardContent className="flex items-center justify-between gap-3 flex-wrap pt-6">
                <span className="text-sm text-red-500 inline-flex items-center gap-2">
                    <WarningCircle className="h-5 w-5" />
                    {message}
                </span>
                <Button variant={"outline"} size="sm" onClick={onRetry}>
                    <ArrowsClockwise className="h-4 w-4 mr-1" />
                    Retry
                </Button>
            </CardContent>
        </Card>
    );
}

const UploadFiles: React.FC<{
    setUploadedFiles: (files: string[]) => void;
}> = ({ setUploadedFiles }) => {
    const [isDragAndDropping, setIsDragAndDropping] = useState(false);

    const [warning, setWarning] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progressValue, setProgressValue] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!uploading) {
            setProgressValue(0);
            if (!warning && !error) {
                // Force close the dialog by simulating a click on the escape key
                const event = new KeyboardEvent("keydown", { key: "Escape" });
                document.dispatchEvent(event);
            }
        }

        if (uploading) {
            const interval = setInterval(() => {
                setProgressValue((prev) => {
                    const increment = Math.floor(Math.random() * 5) + 1; // Generates a random number between 1 and 5
                    const nextValue = prev + increment;
                    return nextValue < 100 ? nextValue : 100; // Ensures progress does not exceed 100
                });
            }, 800);
            return () => clearInterval(interval);
        }
    }, [uploading]);

    function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
        setIsDragAndDropping(true);
    }

    function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
        setIsDragAndDropping(false);
    }

    function handleDragAndDropFiles(event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
        setIsDragAndDropping(false);

        if (!event.dataTransfer.files) return;

        uploadFiles(event.dataTransfer.files);
    }

    function openFileInput() {
        if (fileInputRef && fileInputRef.current) {
            fileInputRef.current.click();
        }
    }

    function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
        if (!event.target.files) return;

        uploadFiles(event.target.files);
    }

    function uploadFiles(files: FileList) {
        uploadDataForIndexing(files, setWarning, setUploading, setError, setUploadedFiles);
    }

    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant={"secondary"} className="mt-4">
                    <Brain className="h-4 w-4 mr-2" />
                    Add Documents
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Build Your Knowledge Base</DialogTitle>
                    <DialogDescription>
                        Add context for your Khoj knowledge base. Quickly search and get
                        personalized answers from your documents.
                    </DialogDescription>
                </DialogHeader>
                <div
                    className={`flex flex-col h-full`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDragAndDropFiles}
                    onClick={openFileInput}
                >
                    <input
                        type="file"
                        multiple
                        ref={fileInputRef}
                        style={{ display: "none" }}
                        onChange={handleFileChange}
                    />
                    <div className="flex-none p-4">
                        {uploading && (
                            <Progress
                                indicatorColor="bg-slate-500"
                                className="w-full h-2 rounded-full"
                                value={progressValue}
                            />
                        )}
                    </div>
                    {warning && (
                        <div className="flex-none p-4 border-b rounded-lg">
                            <div className="flex items-center gap-2">
                                <Lightbulb className="h-6 w-6" />
                                <span>{warning}</span>
                            </div>
                            <Button
                                onClick={() => setWarning(null)}
                                className="mt-2"
                                variant={"ghost"}
                            >
                                Dismiss
                            </Button>
                        </div>
                    )}
                    {error && (
                        <div className="flex-none p-4 border-b rounded-lg">
                            <div className="flex items-center gap-2">
                                <Lightbulb className="h-6 w-6" />
                                <span>{error}</span>
                            </div>
                            <Button
                                onClick={() => setError(null)}
                                className="mt-2"
                                variant={"ghost"}
                            >
                                Dismiss
                            </Button>
                        </div>
                    )}
                    <div
                        className={`flex-none p-4 border-b ${isDragAndDropping ? "animate-pulse border-blue-500 bg-blue-500 bg-opacity-25" : "bg-secondary"} rounded-lg`}
                    >
                        <div className="flex items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-lg">
                            {isDragAndDropping ? (
                                <div className="flex items-center justify-center w-full h-full">
                                    <Waveform className="h-6 w-6 mr-2" />
                                    <span>Drop files to upload</span>
                                </div>
                            ) : (
                                <div className="flex items-center justify-center w-full h-full">
                                    <Plus className="h-6 w-6 mr-2" />
                                    <span>Drag and drop files here</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

interface FileFilterComboBoxProps {
    allFiles: string[];
    onChooseFile: (file: string) => void;
    isMobileWidth: boolean;
    inputText?: string;
    onClose: () => void;
}

function FileFilterComboBox(props: FileFilterComboBoxProps) {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState(props.inputText || "");
    const [noMatchingFiles, setNoMatchingFiles] = useState(false);
    const [inputText, setInputText] = useState("");

    useEffect(() => {
        if (props.inputText) {
            if (props.inputText === "INITIALIZE") {
                setOpen(true);
                setInputText("");
            } else {
                setInputText(props.inputText);
                if (props.allFiles.includes(props.inputText)) {
                    setValue(props.inputText);
                }
            }
        } else {
            setInputText("");
        }
    }, [props.inputText]);

    useEffect(() => {
        if (inputText && !props.allFiles.includes(inputText)) {
            setNoMatchingFiles(true);
            setValue("");
        } else if (!inputText) {
            setNoMatchingFiles(false);
            setValue("");
        } else {
            setNoMatchingFiles(false);
            setValue(inputText);
        }
    }, [inputText, props.allFiles]);

    useEffect(() => {
        if (!open) {
            props.onClose();
        }
    }, [open]);

    return (
        <Popover open={open || (noMatchingFiles && !!inputText)} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={`justify-between" ${props.isMobileWidth ? "w-full" : "w-[200px]"}`}
                >
                    {value
                        ? props.isMobileWidth
                            ? "✔️"
                            : "Selected"
                        : props.isMobileWidth
                          ? " "
                          : "Select file"}
                    <Funnel className="opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0">
                <Command>
                    <CommandInput
                        placeholder="Search files..."
                        value={inputText}
                        onInput={(e) => setInputText(e.currentTarget.value)}
                    />
                    <CommandList>
                        <CommandEmpty>No files found.</CommandEmpty>
                        <CommandGroup>
                            {props.allFiles.map((file) => (
                                <CommandItem
                                    key={file}
                                    value={file}
                                    onSelect={(currentValue) => {
                                        setValue(currentValue === value ? "" : currentValue);
                                        setOpen(false);
                                        props.onChooseFile(currentValue);
                                    }}
                                >
                                    {file}
                                    <Check
                                        className={cn(
                                            "ml-auto",
                                            value === file ? "opacity-100" : "opacity-0",
                                        )}
                                    />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

export default function Search() {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchView, setSearchView] = useState<SearchViewMode>("documents");
    // Snippet (paragraph) view state
    const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
    const [searchResultsLoading, setSearchResultsLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    // Document view state
    const [documentResults, setDocumentResults] = useState<DocumentSearchResult[] | null>(null);
    const [documentResultsLoading, setDocumentResultsLoading] = useState(false);
    const [documentSearchError, setDocumentSearchError] = useState<string | null>(null);
    const [expandedDocuments, setExpandedDocuments] = useState<
        Record<string, ExpandedDocumentState>
    >({});
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [focusSearchResult, setFocusSearchResult] = useState<SearchResult | null>(null);
    const [files, setFiles] = useState<FileObject[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [fileObjectsLoading, setFileObjectsLoading] = useState(true);
    const [allFiles, setAllFiles] = useState<string[]>([]);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [selectedFileFilter, setSelectedFileFilter] = useState<string | undefined>(undefined);
    const [selectedFileFullText, setSelectedFileFullText] = useState<string | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
    const [pageNumber, setPageNumber] = useState(0);
    const [numPages, setNumPages] = useState(1);

    const { toast } = useToast();

    const isMobileWidth = useIsMobileWidth();

    function resetSearchResults() {
        setSearchResults(null);
        setSearchError(null);
        setDocumentResults(null);
        setDocumentSearchError(null);
        setExpandedDocuments({});
        setFocusSearchResult(null);
    }

    useEffect(() => {
        // Load all files once on page load
        fetch("/api/content/computer", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        })
            .then((response) => response.json())
            .then((data) => {
                setAllFiles(data);
            })
            .catch((error) => {
                console.error("Error loading files:", error);
            });
    }, []);

    useEffect(() => {
        // Replace the file: filter with the selected suggestion
        const fileFilterMatch = searchQuery.match(/file:([^"\s]*|"[^"]*")?/);

        if (fileFilterMatch) {
            const extractedFileFilter = fileFilterMatch[1];
            // Strip the double quotes
            const extractedFileFilterValue = extractedFileFilter?.replace(/"/g, "");

            if (extractedFileFilterValue) {
                setSelectedFileFilter(extractedFileFilterValue);
            } else {
                setSelectedFileFilter("INITIALIZE");
            }
        }
    }, [searchQuery]);

    function handleSearchInputChange(value: string) {
        setSearchQuery(value);

        if (!value.trim()) {
            resetSearchResults();
            return;
        }

        // Clear previous search timeout
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        // Debounce search
        if (value.trim()) {
            searchTimeoutRef.current = setTimeout(() => {
                search();
            }, 750);
        }
    }

    function applySuggestion(suggestion: string) {
        // Scrub any existing `file:` filter
        const fileFilterRegex = /file:([^"\s]*|"[^"]*")?/i;
        const searchQueryWithoutFileFilter = searchQuery.replace(fileFilterRegex, "").trim();

        // Prepend the file: filter with the selected suggestion
        const newQuery = `file:"${suggestion}" ${searchQueryWithoutFileFilter}`;
        setSearchQuery(newQuery);
        searchInputRef.current?.focus();
        search(newQuery);
    }

    function handleSwitchView(mode: SearchViewMode) {
        if (mode === searchView) return;
        setSearchView(mode);
        setFocusSearchResult(null);
        // Run the search in the selected view if a query is already present
        if (searchQuery.trim()) {
            if (mode === "documents") {
                searchDocuments(searchQuery);
            } else {
                searchSnippets(searchQuery);
            }
        }
    }

    function search(queryOverride?: string) {
        const query = queryOverride ?? searchQuery;
        if (searchView === "documents") {
            searchDocuments(query);
        } else {
            searchSnippets(query);
        }
    }

    function searchSnippets(queryOverride?: string) {
        const query = (queryOverride ?? searchQuery).trim();
        if (searchResultsLoading || !query) return;

        setSearchResultsLoading(true);
        setSearchError(null);

        const apiUrl = `/api/search?q=${encodeURIComponent(query)}&client=web`;
        fetch(apiUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Search failed with status ${response.status}`);
                }
                const data = await response.json();
                setSearchResults(Array.isArray(data) ? data : []);
            })
            .catch((error) => {
                console.error("Error:", error);
                setSearchError("Failed to load search results. Please try again.");
            })
            .finally(() => {
                setSearchResultsLoading(false);
            });
    }

    function searchDocuments(queryOverride?: string) {
        const query = (queryOverride ?? searchQuery).trim();
        if (documentResultsLoading || !query) return;

        setDocumentResultsLoading(true);
        setDocumentSearchError(null);
        setExpandedDocuments({});

        const apiUrl = `/api/search/documents?q=${encodeURIComponent(query)}&client=web&n=5`;
        fetch(apiUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Document search failed with status ${response.status}`);
                }
                const data = await response.json();
                setDocumentResults(Array.isArray(data) ? data : []);
            })
            .catch((error) => {
                console.error("Error:", error);
                setDocumentSearchError("Failed to load documents. Please try again.");
            })
            .finally(() => {
                setDocumentResultsLoading(false);
            });
    }

    function fetchDocumentParagraphs(additional: AdditionalData) {
        const key = getDocumentKey(additional);
        const query = searchQuery.trim();
        if (!query) return;

        setExpandedDocuments((previous) => ({
            ...previous,
            [key]: { status: "loading", paragraphs: [] },
        }));

        const params = new URLSearchParams({
            q: query,
            file: additional.file,
            source: additional.source,
            client: "web",
            n: "5",
        });

        fetch(`/api/search/document?${params.toString()}`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`Document sections failed with status ${response.status}`);
                }
                const data = await response.json();
                setExpandedDocuments((previous) => ({
                    ...previous,
                    [key]: {
                        status: "loaded",
                        paragraphs: Array.isArray(data) ? data : [],
                    },
                }));
            })
            .catch((error) => {
                console.error("Error:", error);
                setExpandedDocuments((previous) => ({
                    ...previous,
                    [key]: { status: "error", paragraphs: [] },
                }));
            });
    }

    function toggleDocument(additional: AdditionalData) {
        const key = getDocumentKey(additional);
        if (expandedDocuments[key] !== undefined) {
            // Collapse the document
            setExpandedDocuments((previous) => {
                const updated = { ...previous };
                delete updated[key];
                return updated;
            });
        } else {
            fetchDocumentParagraphs(additional);
        }
    }

    const fetchFiles = async (currentPageNumber: number) => {
        try {
            const url = `api/content/files?page=${currentPageNumber}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to fetch files");

            const filesData = await response.json();
            const filesList = filesData.files;
            const totalPages = filesData.num_pages;

            setNumPages(totalPages);

            if (Array.isArray(filesList)) {
                setFiles(filesList.toSorted());
            }
        } catch (error) {
            setError("Failed to load files");
            console.error("Error fetching files:", error);
        } finally {
            setFileObjectsLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles(pageNumber);
    }, [pageNumber]);

    const fetchSpecificFile = async (fileName: string) => {
        try {
            const response = await fetch(`/api/content/file?file_name=${fileName}`);
            if (!response.ok) throw new Error("Failed to fetch file");

            const file = await response.json();
            setSelectedFileFullText(file.raw_text);
        } catch (error) {
            setError("Failed to load file");
            console.error("Error fetching file:", error);
        }
    };

    const handleDownload = (fileName: string, content: string) => {
        const blob = new Blob([content], { type: "text/plain" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${fileName.split("/").pop()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    };

    useEffect(() => {
        if (selectedFile) {
            fetchSpecificFile(selectedFile);
        }
    }, [selectedFile]);

    useEffect(() => {
        fetchFiles(pageNumber);
    }, []);

    useEffect(() => {
        if (uploadedFiles.length > 0) {
            setPageNumber(0);
            fetchFiles(0);
        }
    }, [uploadedFiles]);

    const handleDelete = async (fileName: string) => {
        setIsDeleting(true);
        try {
            const response = await fetch(`/api/content/file?filename=${fileName}`, {
                method: "DELETE",
            });
            if (!response.ok) throw new Error("Failed to delete file");
            toast({
                title: "File deleted",
                description: `File ${fileName} has been deleted`,
                variant: "default",
            });

            // Refresh files list
            fetchFiles(pageNumber);
        } catch (error) {
            toast({
                title: "Error deleting file",
                description: `Failed to delete file ${fileName}`,
                variant: "destructive",
            });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <SidebarProvider>
            <AppSidebar conversationId={""} />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="mr-2 h-4" />
                    {isMobileWidth ? (
                        <Link className="p-0 no-underline" href="/">
                            <KhojLogoType className="h-auto w-16" />
                        </Link>
                    ) : (
                        <h2 className="text-lg">Search Your Knowledge Base</h2>
                    )}
                </header>
                <div>
                    <div className={`${styles.searchLayout}`}>
                        <div className="w-full md:w-5/6 mx-auto pt-6 md:pt-8">
                            <div className="p-4 w-full mx-auto">
                                <div className="flex justify-between items-center border-2 border-muted p-1 gap-1 rounded-lg flex-col md:flex-row">
                                    <div className="relative flex-1 w-full">
                                        <Input
                                            autoFocus={true}
                                            className="border-none pl-4 focus-visible:ring-transparent focus-visible:ring-offset-transparent"
                                            onChange={(e) =>
                                                handleSearchInputChange(e.currentTarget.value)
                                            }
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    search();
                                                }
                                            }}
                                            ref={searchInputRef}
                                            type="search"
                                            placeholder="Search Documents"
                                            value={searchQuery}
                                        />
                                    </div>
                                    <div id="actions" className="flex gap-2">
                                        <FileFilterComboBox
                                            allFiles={allFiles}
                                            onChooseFile={(file) => applySuggestion(file)}
                                            isMobileWidth={isMobileWidth}
                                            inputText={selectedFileFilter}
                                            onClose={() => searchInputRef.current?.focus()}
                                        />
                                        <Button
                                            className="px-2 gap-2 inline-flex rounded-none items-center border-l border-gray-300 hover:text-gray-500"
                                            variant={"ghost"}
                                            onClick={() => search()}
                                        >
                                            <MagnifyingGlass className="h-4 w-4" />
                                            <span>Find</span>
                                        </Button>
                                    </div>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">View</span>
                                    <Button
                                        variant={searchView === "documents" ? "default" : "outline"}
                                        size="sm"
                                        className="gap-1"
                                        onClick={() => handleSwitchView("documents")}
                                        aria-pressed={searchView === "documents"}
                                    >
                                        <Files className="h-4 w-4" />
                                        Documents
                                    </Button>
                                    <Button
                                        variant={searchView === "snippets" ? "default" : "outline"}
                                        size="sm"
                                        className="gap-1"
                                        onClick={() => handleSwitchView("snippets")}
                                        aria-pressed={searchView === "snippets"}
                                    >
                                        <ListBullets className="h-4 w-4" />
                                        Paragraphs
                                    </Button>
                                </div>
                                {searchResults === null && documentResults === null && (
                                    <UploadFiles setUploadedFiles={setUploadedFiles} />
                                )}
                                {searchView === "documents" && documentResultsLoading && (
                                    <div className="mt-4 flex items-center justify-center">
                                        <InlineLoading
                                            className="mt-4"
                                            message={"Searching documents"}
                                            iconClassName="h-5 w-5"
                                        />
                                    </div>
                                )}
                                {searchView === "documents" &&
                                    !documentResultsLoading &&
                                    documentSearchError && (
                                        <SearchErrorState
                                            message={documentSearchError}
                                            onRetry={() => searchDocuments()}
                                        />
                                    )}
                                {searchView === "documents" &&
                                    !documentResultsLoading &&
                                    !documentSearchError &&
                                    documentResults !== null &&
                                    documentResults.length === 0 && (
                                        <EmptySearchResults query={searchQuery} />
                                    )}
                                {searchView === "documents" &&
                                    !documentResultsLoading &&
                                    !documentSearchError &&
                                    documentResults &&
                                    documentResults.length > 0 && (
                                        <div className="mt-4 max-w-[92vw]">
                                            <Button
                                                onClick={() => handleSearchInputChange("")}
                                                className="mb-4"
                                                variant={"outline"}
                                            >
                                                <ArrowLeft className="inline mr-2" />
                                                See All
                                            </Button>
                                            <ScrollArea className="h-[80vh]">
                                                {documentResults.map((documentResult) => {
                                                    const documentKey = getDocumentKey(
                                                        documentResult.best.additional,
                                                    );
                                                    return (
                                                        <DocumentCard
                                                            key={documentKey}
                                                            document={documentResult}
                                                            expandedState={
                                                                expandedDocuments[documentKey]
                                                            }
                                                            onToggleExpand={() =>
                                                                toggleDocument(
                                                                    documentResult.best.additional,
                                                                )
                                                            }
                                                            onRetry={() =>
                                                                fetchDocumentParagraphs(
                                                                    documentResult.best.additional,
                                                                )
                                                            }
                                                        />
                                                    );
                                                })}
                                            </ScrollArea>
                                        </div>
                                    )}
                                {searchView === "snippets" && searchResultsLoading && (
                                    <div className="mt-4 flex items-center justify-center">
                                        <InlineLoading
                                            className="mt-4"
                                            message={"Searching"}
                                            iconClassName="h-5 w-5"
                                        />
                                    </div>
                                )}
                                {searchView === "snippets" &&
                                    !searchResultsLoading &&
                                    searchError && (
                                        <SearchErrorState
                                            message={searchError}
                                            onRetry={() => searchSnippets()}
                                        />
                                    )}
                                {searchView === "snippets" && focusSearchResult && (
                                    <div className="mt-4">
                                        <Button
                                            onClick={() => setFocusSearchResult(null)}
                                            className="mb-4"
                                            variant={"outline"}
                                        >
                                            <ArrowLeft className="inline mr-2" />
                                            Back
                                        </Button>
                                        {focusNote(focusSearchResult)}
                                    </div>
                                )}
                                {searchView === "snippets" &&
                                    !focusSearchResult &&
                                    !searchResultsLoading &&
                                    !searchError &&
                                    searchResults !== null &&
                                    searchResults.length === 0 && (
                                        <EmptySearchResults query={searchQuery} />
                                    )}
                                {searchView === "snippets" &&
                                    !focusSearchResult &&
                                    !searchResultsLoading &&
                                    !searchError &&
                                    searchResults &&
                                    searchResults.length > 0 && (
                                        <div className="mt-4 max-w-[92vw] break-all">
                                            <Button
                                                onClick={() => handleSearchInputChange("")}
                                                className="mb-4"
                                                variant={"outline"}
                                            >
                                                <ArrowLeft className="inline mr-2" />
                                                See All
                                            </Button>
                                            <ScrollArea className="h-[80vh]">
                                                {searchResults.map((result, index) => {
                                                    return (
                                                        <Note
                                                            key={result["corpus-id"]}
                                                            note={result}
                                                            setFocusSearchResult={
                                                                setFocusSearchResult
                                                            }
                                                        />
                                                    );
                                                })}
                                            </ScrollArea>
                                        </div>
                                    )}
                                {!searchResultsLoading &&
                                    !documentResultsLoading &&
                                    searchResults === null &&
                                    documentResults === null &&
                                    !searchQuery.trim() && (
                                        <div className="w-full mt-4">
                                            {fileObjectsLoading && (
                                                <div className="mt-4 flex items-center justify-center">
                                                    <InlineLoading
                                                        className="mt-4"
                                                        message={"Loading"}
                                                        iconClassName="h-5 w-5"
                                                    />
                                                </div>
                                            )}
                                            {error && <div className="text-red-500">{error}</div>}

                                            {!searchResults &&
                                                !fileObjectsLoading &&
                                                files.length === 0 && (
                                                    <Card className="flex flex-col items-center justify-center border-none shadow-none">
                                                        <CardHeader className="flex flex-col items-center justify-center">
                                                            <CardDescription className="border-muted-foreground border w-fit rounded-lg mb-2 text-center text-lg p-4">
                                                                <FileDashed
                                                                    weight="fill"
                                                                    className="text-muted-foreground h-10 w-10"
                                                                />
                                                            </CardDescription>
                                                            <CardTitle className="text-center">
                                                                Let&apos;s get started!
                                                            </CardTitle>
                                                        </CardHeader>
                                                        <CardContent>
                                                            <div className="text-muted-foreground items-center justify-center text-center flex">
                                                                To use search, upload docs via the
                                                                &quot;Add Documents&quot; button.
                                                            </div>
                                                            <Link
                                                                href="https://docs.khoj.dev/data-sources/share_your_data"
                                                                className="no-underline"
                                                            >
                                                                <div className="mt-4 text-center text-secondary-foreground bg-secondary w-fit m-auto p-2 rounded-lg">
                                                                    Learn More
                                                                </div>
                                                            </Link>
                                                        </CardContent>
                                                    </Card>
                                                )}

                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                                {files.map((file, index) => (
                                                    <FileCard
                                                        key={index}
                                                        file={file}
                                                        index={index}
                                                        setSelectedFile={setSelectedFile}
                                                        setSelectedFileFullText={
                                                            setSelectedFileFullText
                                                        }
                                                        handleDownload={handleDownload}
                                                        handleDelete={handleDelete}
                                                        isDeleting={isDeleting}
                                                        selectedFileFullText={selectedFileFullText}
                                                    />
                                                ))}
                                            </div>

                                            <Pagination>
                                                <PaginationContent className="p-0">
                                                    {/* Show prev button if not on first page */}
                                                    {pageNumber > 0 && (
                                                        <PaginationItem className="list-none">
                                                            <PaginationPrevious
                                                                onClick={() =>
                                                                    setPageNumber(pageNumber - 1)
                                                                }
                                                            />
                                                        </PaginationItem>
                                                    )}

                                                    {/* Show first page if not on first two pages */}
                                                    {pageNumber > 1 && (
                                                        <PaginationItem className="list-none">
                                                            <PaginationLink
                                                                onClick={() => setPageNumber(0)}
                                                            >
                                                                1
                                                            </PaginationLink>
                                                        </PaginationItem>
                                                    )}

                                                    {/* Show ellipsis if there's a gap */}
                                                    {pageNumber > 2 && (
                                                        <PaginationItem className="list-none">
                                                            <PaginationEllipsis />
                                                        </PaginationItem>
                                                    )}

                                                    {/* Show previous page if not on first page */}
                                                    {pageNumber > 0 && (
                                                        <PaginationItem className="list-none">
                                                            <PaginationLink
                                                                onClick={() =>
                                                                    setPageNumber(pageNumber - 1)
                                                                }
                                                            >
                                                                {pageNumber}
                                                            </PaginationLink>
                                                        </PaginationItem>
                                                    )}

                                                    {/* Current page */}
                                                    <PaginationItem className="list-none">
                                                        <PaginationLink isActive>
                                                            {pageNumber + 1}
                                                        </PaginationLink>
                                                    </PaginationItem>

                                                    {/* Show next page if not on last page */}
                                                    {pageNumber < numPages - 1 && (
                                                        <PaginationItem className="list-none">
                                                            <PaginationLink
                                                                onClick={() =>
                                                                    setPageNumber(pageNumber + 1)
                                                                }
                                                            >
                                                                {pageNumber + 2}
                                                            </PaginationLink>
                                                        </PaginationItem>
                                                    )}

                                                    {/* Show ellipsis if there's a gap before last page */}
                                                    {pageNumber < numPages - 3 && (
                                                        <PaginationItem className="list-none">
                                                            <PaginationEllipsis />
                                                        </PaginationItem>
                                                    )}

                                                    {/* Show last page if not on last two pages */}
                                                    {pageNumber < numPages - 2 && (
                                                        <PaginationItem className="list-none">
                                                            <PaginationLink
                                                                onClick={() =>
                                                                    setPageNumber(numPages - 1)
                                                                }
                                                            >
                                                                {numPages}
                                                            </PaginationLink>
                                                        </PaginationItem>
                                                    )}

                                                    {/* Show next button if not on last page */}
                                                    {pageNumber < numPages - 1 && (
                                                        <PaginationItem className="list-none">
                                                            <PaginationNext
                                                                onClick={() =>
                                                                    setPageNumber(pageNumber + 1)
                                                                }
                                                            />
                                                        </PaginationItem>
                                                    )}
                                                </PaginationContent>
                                            </Pagination>
                                        </div>
                                    )}
                            </div>
                        </div>
                    </div>
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}
