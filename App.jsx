import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createEditor,
  Editor,
  Text,
  Transforms,
  Range,
  type Descendant,
  type NodeEntry,
} from "slate";
import { Slate, Editable, withReact, ReactEditor } from "slate-react";
import { withHistory } from "slate-history";
import clsx from "clsx";

// ─── Types ────────────────────────────────────────────────────────────────────

type textStyle = "bold" | "italic" | "underline" | "strikethrough" | "code";

interface CommentMark {
  id: string;
  text: string;
  comment: string;
  time: string;
  anchor: { path: number[]; offset: number };
  focus: { path: number[]; offset: number };
  isResolved: boolean;
}

interface FloatingToolbarState {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  range: Range | null;
}

/** Removes a pending <mark> inserted during selection, unwrapping its children back into the DOM */
function removePendingMark(markEl: HTMLElement | null) {
  if (!markEl || !markEl.parentNode) return;
  const parent = markEl.parentNode;
  while (markEl.firstChild) parent.insertBefore(markEl.firstChild, markEl);
  parent.removeChild(markEl);
  parent.normalize();
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const LS_KEY = (docId: string) => `slate_comments_${docId}`;

function loadComments(docId: string): CommentMark[] {
  try {
    const raw = localStorage.getItem(LS_KEY(docId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveComments(docId: string, comments: CommentMark[]) {
  localStorage.setItem(LS_KEY(docId), JSON.stringify(comments));
}

// ─── Toolbar (minimal inline) ─────────────────────────────────────────────────

const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) Editor.removeMark(editor, format);
  else Editor.addMark(editor, format, true);
};

function Toolbar({
  editor,
  readOnly,
}: {
  editor: Editor;
  readOnly?: boolean;
}) {
  if (readOnly) return null;
  const btn = (label: string, fmt: textStyle, style?: React.CSSProperties) => (
    <button
      key={fmt}
      onMouseDown={(e) => {
        e.preventDefault();
        toggleMark(editor, fmt);
      }}
      style={{
        marginRight: 4,
        padding: "2px 8px",
        fontWeight: fmt === "bold" ? 700 : 400,
        fontStyle: fmt === "italic" ? "italic" : "normal",
        textDecoration:
          fmt === "underline"
            ? "underline"
            : fmt === "strikethrough"
            ? "line-through"
            : "none",
        cursor: "pointer",
        borderRadius: 4,
        border: "1px solid #d1d5db",
        background: "#f9fafb",
        ...style,
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      style={{
        padding: "6px 12px",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        gap: 4,
      }}
    >
      {btn("B", "bold")}
      {btn("I", "italic")}
      {btn("U", "underline")}
      {btn("S", "strikethrough")}
    </div>
  );
}

// ─── Floating Comment Bubble ───────────────────────────────────────────────────

function FloatingCommentBubble({
  state,
  onSubmit,
  onCancel,
}: {
  state: FloatingToolbarState;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");

  if (!state.visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: state.y,
        left: state.x,
        zIndex: 9999,
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        boxShadow:
          "0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)",
        padding: "12px 14px",
        minWidth: 260,
        maxWidth: 320,
        animation: "bubbleIn 0.18s cubic-bezier(0.34,1.56,0.64,1)",
      }}
    >
      <style>{`
        @keyframes bubbleIn {
          from { opacity:0; transform:translateY(-6px) scale(0.96); }
          to   { opacity:1; transform:translateY(0)   scale(1); }
        }
      `}</style>

      {/* selected text preview */}
      {state.selectedText && (
        <div
          style={{
            fontSize: 11,
            color: "#6b7280",
            marginBottom: 8,
            padding: "4px 8px",
            background: "#fef9c3",
            borderRadius: 6,
            borderLeft: "3px solid #f59e0b",
            maxHeight: 48,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          "{state.selectedText}"
        </div>
      )}

      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment…"
        rows={3}
        style={{
          width: "100%",
          resize: "none",
          border: "1px solid #d1d5db",
          borderRadius: 8,
          padding: "8px 10px",
          fontSize: 13,
          fontFamily: "inherit",
          outline: "none",
          boxSizing: "border-box",
          lineHeight: 1.5,
          color: "#111827",
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (text.trim()) { onSubmit(text.trim()); setText(""); }
          }
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 8,
        }}
      >
        <button
          onClick={onCancel}
          style={{
            padding: "5px 12px",
            borderRadius: 7,
            border: "1px solid #d1d5db",
            background: "#f9fafb",
            cursor: "pointer",
            fontSize: 12,
            color: "#374151",
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (text.trim()) { onSubmit(text.trim()); setText(""); }
          }}
          style={{
            padding: "5px 14px",
            borderRadius: 7,
            border: "none",
            background: "#3b82f6",
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Comment ⌘↵
        </button>
      </div>
    </div>
  );
}

// ─── Comment Sidebar ──────────────────────────────────────────────────────────

function CommentSidebar({
  comments,
  activeId,
  onResolve,
  onDelete,
  onActivate,
}: {
  comments: CommentMark[];
  activeId?: string;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  const unresolved = comments.filter((c) => !c.isResolved);
  const resolved = comments.filter((c) => c.isResolved);

  const Card = ({ c }: { c: CommentMark }) => (
    <div
      onClick={() => onActivate(c.id)}
      style={{
        padding: "10px 12px",
        marginBottom: 8,
        borderRadius: 10,
        border: `1.5px solid ${activeId === c.id ? "#3b82f6" : "#e5e7eb"}`,
        background: activeId === c.id ? "#eff6ff" : "#fff",
        cursor: "pointer",
        transition: "all 0.15s",
        opacity: c.isResolved ? 0.5 : 1,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#6b7280",
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          borderLeft: "3px solid #f59e0b",
          paddingLeft: 6,
        }}
      >
        "{c.text}"
      </div>
      <div style={{ fontSize: 13, color: "#111827", marginBottom: 6 }}>
        {c.comment}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 10, color: "#9ca3af" }}>
          {new Date(c.time).toLocaleString()}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          {!c.isResolved && (
            <button
              onClick={(e) => { e.stopPropagation(); onResolve(c.id); }}
              style={{
                fontSize: 10,
                padding: "2px 7px",
                borderRadius: 5,
                border: "1px solid #d1fae5",
                background: "#ecfdf5",
                color: "#065f46",
                cursor: "pointer",
              }}
            >
              ✓ Resolve
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
            style={{
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 5,
              border: "1px solid #fee2e2",
              background: "#fef2f2",
              color: "#991b1b",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div
      style={{
        width: 280,
        borderLeft: "1px solid #e5e7eb",
        padding: "16px 14px",
        overflowY: "auto",
        background: "#fafafa",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#374151",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        Comments ({unresolved.length})
      </div>

      {unresolved.length === 0 && (
        <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", marginTop: 40 }}>
          Select text in preview mode<br />to add a comment
        </div>
      )}

      {unresolved.map((c) => <Card key={c.id} c={c} />)}

      {resolved.length > 0 && (
        <>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#9ca3af",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              margin: "16px 0 8px",
            }}
          >
            Resolved ({resolved.length})
          </div>
          {resolved.map((c) => <Card key={c.id} c={c} />)}
        </>
      )}
    </div>
  );
}

// ─── Main Editor ──────────────────────────────────────────────────────────────

interface SlateEditorProps {
  value?: Descendant[];
  defaultValue?: Descendant[];
  onChange?: (value: Descendant[]) => void;
  readOnly?: boolean;
  onClickSaveBtn?: (nodes: Descendant[]) => void;
  className?: string;
  data?: Record<string, any>;
  onDiscard?: () => void;
  hideFontActions?: boolean;
  hideAlignmentActions?: boolean;
  hideIndentActions?: boolean;
  isShowComments?: boolean;
  onCommentsWindowClose?: () => void;
  /** Used as the localStorage key for comments */
  artifactJobID?: string;
}

const DOC_ID_FALLBACK = "default_doc";

export const SlateContentEditor = ({
  value,
  defaultValue = [{ type: "paragraph", children: [{ text: "" }] } as any],
  onChange,
  readOnly,
  onClickSaveBtn,
  className,
  onDiscard,
  isShowComments = false,
  onCommentsWindowClose,
  artifactJobID,
}: SlateEditorProps) => {
  const docId = artifactJobID ?? DOC_ID_FALLBACK;

  const editor = useMemo(
    () => withHistory(withReact(createEditor())),
    []
  );

  // ── comments state ──
  const [comments, setComments] = useState<CommentMark[]>(() =>
    loadComments(docId)
  );
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();

  // persist whenever comments change
  useEffect(() => {
    saveComments(docId, comments);
  }, [comments, docId]);

  // ── floating bubble ──
  const [bubble, setBubble] = useState<FloatingToolbarState>({
    visible: false,
    x: 0,
    y: 0,
    selectedText: "",
    range: null,
  });

  // ── editor value ──
  const [internalValue, setInternalValue] = useState<Descendant[]>(
    defaultValue
  );
  const editorValue = value ?? internalValue;

  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) setInternalValue(val);
      onChange?.(val);
    },
    [value, onChange]
  );

  // ── decorate: highlight commented ranges + active selection ──
  const decorate = useCallback(
    ([node, path]: NodeEntry) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      // highlight each stored comment
      for (const c of comments) {
        try {
          const anchor = { path: c.anchor.path, offset: c.anchor.offset };
          const focus = { path: c.focus.path, offset: c.focus.offset };
          // only decorate if this text node is at the anchor path (simplified)
          if (
            JSON.stringify(path) === JSON.stringify(anchor.path) &&
            JSON.stringify(path) === JSON.stringify(focus.path)
          ) {
            ranges.push({
              anchor,
              focus,
              commentHighlight: true,
              commentId: c.id,
              isActive: c.id === activeCommentId,
              isResolved: c.isResolved,
            });
          }
        } catch { /* skip malformed */ }
      }

      return ranges;
    },
    [comments, activeCommentId]
  );

  // ── renderLeaf ──
  const renderLeaf = useCallback(({ attributes, children, leaf }: any) => {
    let el = children;
    if (leaf.bold) el = <strong>{el}</strong>;
    if (leaf.italic) el = <em>{el}</em>;
    if (leaf.underline) el = <u>{el}</u>;
    if (leaf.strikethrough) el = <s>{el}</s>;
    if (leaf.code) el = <code>{el}</code>;

    const highlightStyle: React.CSSProperties = leaf.commentHighlight
      ? {
          backgroundColor: leaf.isResolved
            ? "rgba(156,163,175,0.25)"
            : leaf.isActive
            ? "rgba(59,130,246,0.25)"
            : "rgba(251,191,36,0.35)",
          borderBottom: leaf.isResolved
            ? "1.5px solid #9ca3af"
            : "1.5px solid #f59e0b",
          borderRadius: 2,
          cursor: "pointer",
        }
      : {};

    return (
      <span
        {...attributes}
        style={highlightStyle}
        onClick={
          leaf.commentHighlight
            ? () => setActiveCommentId(leaf.commentId)
            : undefined
        }
      >
        {el}
      </span>
    );
  }, [activeCommentId]);

  // ── renderElement ──
  const renderElement = useCallback(({ attributes, children, element }: any) => {
    const style: React.CSSProperties = {
      textAlign: element.align || "left",
      paddingLeft: element.indent ? `${element.indent * 24}px` : undefined,
      fontSize: element.fontSize ? `${element.fontSize}px` : undefined,
    };
    switch (element.type) {
      case "heading-one": return <h1 {...attributes} style={style}>{children}</h1>;
      case "heading-two": return <h2 {...attributes} style={style}>{children}</h2>;
      case "heading-three": return <h3 {...attributes} style={style}>{children}</h3>;
      case "bulleted-list": return <ul {...attributes} style={style}>{children}</ul>;
      case "numbered-list": return <ol {...attributes} style={style}>{children}</ol>;
      case "list-item": return <li {...attributes} style={style}>{children}</li>;
      case "block-quote":
        return (
          <blockquote
            {...attributes}
            style={{
              borderLeft: "3px solid #ccc",
              color: "#666",
              ...style,
              paddingLeft: style.paddingLeft || "12px",
            }}
          >
            {children}
          </blockquote>
        );
      case "table":
        return (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody {...attributes}>{children}</tbody>
          </table>
        );
      case "table-row": return <tr {...attributes}>{children}</tr>;
      case "table-cell": return <td {...attributes} style={{ border: "1px solid #e5e7eb", padding: 6, ...style }}>{children}</td>;
      case "table-cell-header": return <th {...attributes} style={{ border: "1px solid #e5e7eb", padding: 6, background: "#f3f4f6", ...style }}>{children}</th>;
      default:
        return <p {...attributes} style={style}>{children}</p>;
    }
  }, []);

  // ── handle text selection (read-only mode only) ──
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const pendingMarkRef = useRef<HTMLElement | null>(null);

  const handleSelectionChange = useCallback(() => {
    if (!readOnly) return;

    const nativeSel = window.getSelection();
    if (!nativeSel || nativeSel.isCollapsed || !nativeSel.toString().trim()) {
      setBubble((b) => ({ ...b, visible: false }));
      return;
    }

    const selectedText = nativeSel.toString().trim();
    const range = nativeSel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Remove any previous pending mark before wrapping a new one
    removePendingMark(pendingMarkRef.current);
    pendingMarkRef.current = null;

    // Wrap the selection in a <mark> so it stays highlighted after selection clears
    const mark = document.createElement("mark");
    mark.style.cssText =
      "background:rgba(251,191,36,0.45);border-bottom:2px solid #f59e0b;border-radius:2px;";
    try {
      range.surroundContents(mark);
    } catch {
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
    }
    pendingMarkRef.current = mark;

    // Clear native selection — the <mark> keeps the visual highlight
    nativeSel.removeAllRanges();

    // Get Slate range from the mark's position
    const x = Math.min(rect.right + 12, window.innerWidth - 340);
    const y = rect.bottom + 8;

    try {
      const newRange = document.createRange();
      newRange.selectNodeContents(mark);
      const slateRange = ReactEditor.toSlateRange(editor, {
        anchorNode: newRange.startContainer,
        anchorOffset: newRange.startOffset,
        focusNode: newRange.endContainer,
        focusOffset: newRange.endOffset,
        isCollapsed: false,
      } as any, { exactMatch: false });
      setBubble({ visible: true, x, y, selectedText, range: slateRange });
    } catch {
      setBubble({ visible: true, x, y, selectedText, range: null });
    }
  }, [editor, readOnly]);

  /** Cancel: remove the pending highlight mark and close the bubble */
  const handleCancelComment = useCallback(() => {
    removePendingMark(pendingMarkRef.current);
    pendingMarkRef.current = null;
    setBubble({ visible: false, x: 0, y: 0, selectedText: "", range: null });
    window.getSelection()?.removeAllRanges();
  }, []);

  const handleSubmitComment = useCallback(
    (commentText: string) => {
      if (!bubble.selectedText) return;

      const selectedText = bubble.selectedText;
      const newComment: CommentMark = {
        id: `cmt_${Date.now()}`,
        text: selectedText,
        comment: commentText,
        time: new Date().toISOString(),
        anchor: {
          path: bubble.range?.anchor.path as number[] ?? [],
          offset: bubble.range?.anchor.offset ?? 0,
        },
        focus: {
          path: bubble.range?.focus.path as number[] ?? [],
          offset: bubble.range?.focus.offset ?? 0,
        },
        isResolved: false,
      };

      // Promote pending <mark> to a saved highlight instead of removing it
      if (pendingMarkRef.current) {
        const mark = pendingMarkRef.current;
        mark.style.cssText =
          "background:rgba(251,191,36,0.32);border-bottom:1.5px solid #f59e0b;border-radius:2px;cursor:pointer;";
        mark.dataset.cid = newComment.id;
        mark.onclick = () => setActiveCommentId(newComment.id);
        pendingMarkRef.current = null;
      }

      setComments((prev) => {
        const next = [...prev, newComment];
        saveComments(docId, next);
        return next;
      });
      setActiveCommentId(newComment.id);
      setBubble({ visible: false, x: 0, y: 0, selectedText: "", range: null });
      window.getSelection()?.removeAllRanges();
    },
    [bubble, docId]
  );

  const handleResolve = useCallback((id: string) => {
    setComments((prev) =>
      prev.map((c) => (c.id === id ? { ...c, isResolved: true } : c))
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    setActiveCommentId((a) => (a === id ? undefined : a));
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      switch (event.key) {
        case "b": event.preventDefault(); toggleMark(editor, "bold"); break;
        case "i": event.preventDefault(); toggleMark(editor, "italic"); break;
        case "u": event.preventDefault(); toggleMark(editor, "underline"); break;
      }
    },
    [editor]
  );

  // close bubble on outside click — also removes the pending highlight
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-comment-bubble]")) return;
      if (bubble.visible) handleCancelComment();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [bubble.visible, handleCancelComment]);

  return (
    <>
      {/* Global highlight styles */}
      <style>{`
        .slate-editor-highlight::selection { background: rgba(251,191,36,0.4); }
      `}</style>

      <div
        style={{
          display: "flex",
          height: "100%",
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {/* Editor area */}
        <div
          ref={editorContainerRef}
          style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
        >
          {/* Mode badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 14px",
              borderBottom: "1px solid #f3f4f6",
              background: readOnly ? "#f0fdf4" : "#fff",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                color: readOnly ? "#15803d" : "#6b7280",
              }}
            >
              {readOnly ? "👁 Preview — select text to comment" : "✏️ Edit mode"}
            </span>
            {onCommentsWindowClose && (
              <button
                onClick={onCommentsWindowClose}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                Close comments
              </button>
            )}
          </div>

          <Slate editor={editor} initialValue={editorValue} onChange={handleChange}>
            <Toolbar editor={editor} readOnly={readOnly} />
            <Editable
              decorate={decorate}
              renderLeaf={renderLeaf}
              renderElement={renderElement}
              readOnly={readOnly}
              onKeyDown={handleKeyDown}
              onMouseUp={handleSelectionChange}
              onKeyUp={handleSelectionChange}
              className={clsx("slate-editor-highlight", className)}
              style={{
                flex: 1,
                padding: "20px 28px",
                overflowY: "auto",
                minHeight: 300,
                outline: "none",
                fontSize: 15,
                lineHeight: 1.7,
                color: "#1f2937",
              }}
            />
          </Slate>

          {onClickSaveBtn && !readOnly && (
            <div
              style={{
                padding: "10px 16px",
                borderTop: "1px solid #f3f4f6",
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              {onDiscard && (
                <button
                  onClick={onDiscard}
                  style={{
                    padding: "6px 16px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Discard
                </button>
              )}
              <button
                onClick={() => onClickSaveBtn(editor.children)}
                style={{
                  padding: "6px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "#2563eb",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          )}
        </div>

        {/* Comment sidebar */}
        {isShowComments && (
          <CommentSidebar
            comments={comments}
            activeId={activeCommentId}
            onResolve={handleResolve}
            onDelete={handleDelete}
            onActivate={setActiveCommentId}
          />
        )}
      </div>

      {/* Floating comment bubble — only in readOnly */}
      {readOnly && (
        <div data-comment-bubble>
          <FloatingCommentBubble
            state={bubble}
            onSubmit={handleSubmitComment}
            onCancel={handleCancelComment}
          />
        </div>
      )}
    </>
  );
};

export default SlateContentEditor;
