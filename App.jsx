import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createEditor,
  type Descendant,
  Editor,
  Range,
  Transforms,
  Text,
  Node,
} from "slate";
import { Slate, Editable, withReact, ReactEditor } from "slate-react";
import { withHistory } from "slate-history";
import clsx from "clsx";
import Toolbar from "./Toolbar";
import { withTables } from "./plugins/withTables";
import { jsonToSlateValue } from "./utils/jsonConversion";
import type { textStyle } from "./types";
import styles from "./slate-editor.module.css";
import CommentSidebar from "../CommentSidebar";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import type {
  repliesType,
  storedCommentsType,
} from "../OutputGeneration/ActionLogTable";
import {
  addComments,
  fetchComments,
} from "../../store/reducer/comments/action";
import FloatingCommentToolbar from "../FloatingCommentToolbar";
import { v4 as uuid } from "uuid";

// Shape passed to the parent on Save — updated range + selectedText per comment
export interface UpdatedCommentRange {
  id: string;
  range: Range;
  selectedText: string;
}

interface SlateEditorProps {
  value?: Descendant[];
  defaultValue?: Descendant[];
  onChange?: (value: Descendant[]) => void;
  readOnly?: boolean;
  /**
   * Called when the user clicks Save.
   * - `nodes`           — current editor content
   * - `updatedComments` — every comment with its re-resolved range and
   *                       the actual selected text as it now reads in the doc
   */
  onClickSaveBtn?: (
    nodes: Descendant[],
    updatedComments: UpdatedCommentRange[],
  ) => void;
  className?: string;
  data?: Record<string, any>;
  onDiscard?: () => void;
  hideFontActions?: boolean;
  hideAlignmentActions?: boolean;
  hideIndentActions?: boolean;
  isShowComments?: boolean;
  onCommentsWindowClose?: () => void;
  artifactJobID?: string;
  mode?: boolean;
}

interface EditorSelection {
  text: string;
  position: {
    top: number;
    left: number;
  };
  rowIndex?: number | string;
  colField?: string;
}

const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

const SlateContentEditor = ({
  value,
  defaultValue = [],
  onChange,
  readOnly,
  onClickSaveBtn,
  className,
  data,
  onDiscard,
  hideFontActions,
  hideIndentActions,
  hideAlignmentActions,
  isShowComments = false,
  onCommentsWindowClose,
  artifactJobID,
  mode = false,
}: SlateEditorProps) => {
  const dispatch = useAppDispatch();
  const editor = useMemo(
    () => withTables(withHistory(withReact(createEditor()))),
    [],
  );
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>([]);

  const usersDetails = useAppSelector((state) => state.users.userDetails);
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();
  const [selection, setSelection] = useState<EditorSelection | null>(null);

  const [tempRange, setTempRange] = useState<Range | null>(null);
  const activeSpanRef = useRef<Range | null>(null);

  const getCommentsData = useAppSelector((state) => state.comments.comments);

  // ─── Helper: keep ref + state in sync ───────────────────────────────────────
  const setActiveRange = useCallback((range: Range | null) => {
    activeSpanRef.current = range;
    setTempRange(range);
  }, []);

  // ─── Mark Helpers ────────────────────────────────────────────────────────────

  const addCommentMark = useCallback(
    (range: Range, commentId: string) => {
      const previousSelection = editor.selection;
      Transforms.select(editor, range);
      Transforms.setNodes(
        editor,
        { commentId } as Partial<Text>,
        { at: range, match: (n) => Text.isText(n), split: true },
      );
      if (previousSelection) {
        Transforms.select(editor, previousSelection);
      } else {
        Transforms.deselect(editor);
      }
    },
    [editor],
  );

  const removeCommentMark = useCallback(
    (commentId: string) => {
      const nodes = Array.from(
        Editor.nodes(editor, {
          at: [],
          match: (n) => Text.isText(n) && (n as any).commentId === commentId,
        }),
      );
      for (const [, path] of nodes) {
        Transforms.unsetNodes(editor, "commentId", { at: path });
      }
    },
    [editor],
  );

  // ─── Resolve updated range + selectedText from live editor nodes ─────────────
  /**
   * For each stored comment, walk the editor tree to find all text leaves
   * that still carry `commentId === id`. Reconstruct the tightest Range that
   * spans those leaves and re-read the selected text from the current document.
   *
   * This means even if the user edited text inside a commented region, the
   * saved range and selectedText will reflect the document as it is now.
   */
  const resolveCommentRanges = useCallback((): UpdatedCommentRange[] => {
    return storedComments.reduce<UpdatedCommentRange[]>((acc, comment: any) => {
      const matchingNodes = Array.from(
        Editor.nodes(editor, {
          at: [],
          match: (n) => Text.isText(n) && (n as any).commentId === comment.id,
        }),
      );

      if (matchingNodes.length === 0) return acc; // comment text was deleted

      // Build the tightest range that covers all matching leaves
      const firstEntry = matchingNodes[0];
      const lastEntry = matchingNodes[matchingNodes.length - 1];
      const [firstNode, firstPath] = firstEntry;
      const [lastNode, lastPath] = lastEntry;

      const updatedRange: Range = {
        anchor: { path: firstPath, offset: 0 },
        focus: {
          path: lastPath,
          offset: (lastNode as Text).text.length,
        },
      };

      // Re-read the actual text from the editor (may differ from original if edited)
      const selectedText = Editor.string(editor, updatedRange);

      acc.push({ id: comment.id, range: updatedRange, selectedText });
      return acc;
    }, []);
  }, [editor, storedComments]);

  // ─── Save: pass nodes + updated comment ranges to parent ─────────────────────
  const handleSave = useCallback(() => {
    if (!onSaveRef.current) return;
    const updatedComments = resolveCommentRanges();
    onSaveRef.current(editor.children, updatedComments);
  }, [editor, resolveCommentRanges]);

  // ─── Fetch comments ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, []);

  const deletedCommentsData = useAppSelector((state) => state.comments.deleteComment);
  const updatedCommentData = useAppSelector((state) => state.comments.updateComment);
  const uploadCommentData = useAppSelector((state) => state.comments.addComment);

  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, [uploadCommentData?.data]);

  useEffect(() => {
    if (deletedCommentsData?.message === "OK" && artifactJobID)
      dispatch(fetchComments(artifactJobID));
    if (updatedCommentData?.message === "OK" && artifactJobID)
      dispatch(fetchComments(artifactJobID));
  }, [deletedCommentsData, updatedCommentData]);

  // ─── Sync storedComments + marks ─────────────────────────────────────────────

  useEffect(() => {
    if (getCommentsData?.jobId !== artifactJobID) {
      storedComments.forEach((c: any) => removeCommentMark(c.id));
      setStoredComments([]);
      return;
    }

    const existingComments = getCommentsData?.data.map((com) => ({
      id: com.id,
      position: { left: com.position.left, top: com.position.top },
      rowIndex: com.rowIndex,
      colField: com.colField,
      text: com.text,
      range: com.range,
      comment: com.comment,
      time: com.createdAt,
      userId: com.useId,
      isResolved: com.isResolved,
      replies: com.replies.map((reply: repliesType) => ({
        id: reply?.id,
        text: reply?.text,
        createdAt: reply?.createdAt,
        useId: reply?.useId,
      })),
    }));

    const incomingIds = new Set(existingComments.map((c: any) => c.id));
    storedComments.forEach((prev: any) => {
      if (!incomingIds.has(prev.id)) removeCommentMark(prev.id);
    });

    existingComments.forEach((c: any) => {
      if (c.range) {
        try { addCommentMark(c.range, c.id); } catch { /* stale range */ }
      }
    });

    setStoredComments(existingComments);
  }, [getCommentsData, artifactJobID]);

  // ─── Editor value ─────────────────────────────────────────────────────────────

  const onSaveRef = useRef(onClickSaveBtn);
  onSaveRef.current = onClickSaveBtn;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const computedDefault = useMemo(() => {
    if (data) return jsonToSlateValue(data);
    return defaultValue;
  }, [data, defaultValue]);

  const [internalValue, setInternalValue] = useState<Descendant[]>(computedDefault);
  const editorValue = useMemo(() => value ?? internalValue, [value, internalValue]);

  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) setInternalValue(val);
      onChange?.(val);
    },
    [value, onChange],
  );

  const handleDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);

  // ─── Rendering ───────────────────────────────────────────────────────────────

  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      if (leaf.bold) children = <strong>{children}</strong>;
      if (leaf.italic) children = <em>{children}</em>;
      if (leaf.underline) children = <u>{children}</u>;
      if (leaf.strikethrough) children = <s>{children}</s>;
      if (leaf.code) children = <code>{children}</code>;

      if (leaf.isTempHighlight) {
        children = <span className={styles.commentSelection}>{children}</span>;
      }

      if (leaf.commentId) {
        children = <mark className={styles.commentHighlight}>{children}</mark>;
      }

      return <span {...attributes}>{children}</span>;
    },
    [],
  );

  const renderElement = useCallback(
    ({ attributes, children, element }: any) => {
      const style = {
        textAlign: element.align || "left",
        paddingLeft: element.indent ? `${element.indent * 24}px` : undefined,
        fontSize: element.fontSize ? `${element.fontSize}px` : undefined,
      };

      switch (element.type) {
        case "heading-one":
          return <h1 {...attributes} style={style}>{children}</h1>;
        case "heading-two":
          return <h2 {...attributes} style={style}>{children}</h2>;
        case "heading-three":
          return <h3 {...attributes} style={style}>{children}</h3>;
        case "heading-four":
          return <h4 {...attributes} style={style}>{children}</h4>;
        case "heading-five":
          return (
            <h5 {...attributes} style={style} className={element.className || "heading-five"}>
              {children}
            </h5>
          );
        case "heading-six":
          return <h6 {...attributes} style={style}>{children}</h6>;
        case "bulleted-list":
          return <ul {...attributes} style={style}>{children}</ul>;
        case "numbered-list":
          return <ol {...attributes} style={style}>{children}</ol>;
        case "list-item":
          return <li {...attributes} style={style}>{children}</li>;
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
        case "code-block":
          return (
            <pre {...attributes} style={{ background: "#f5f5f5", padding: 12, ...style }}>
              <code>{children}</code>
            </pre>
          );
        case "table":
          return (
            <table className={element.className || "table"}>
              <tbody {...attributes}>{children}</tbody>
            </table>
          );
        case "table-row":
          return <tr {...attributes} style={style}>{children}</tr>;
        case "table-cell-header":
          return <th {...attributes} style={style}>{children}</th>;
        case "table-cell":
          return element.isHeader
            ? <th {...attributes} style={style}>{children}</th>
            : <td {...attributes} style={style}>{children}</td>;
        case "paragraph":
          return (
            <p {...attributes} style={style} className={element.className || "paragraph"}>
              {children}
            </p>
          );
        default:
          return (
            <p {...attributes} style={style} className={element.className || "paragraph"}>
              {children}
            </p>
          );
      }
    },
    [],
  );

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      switch (event.key) {
        case "b": event.preventDefault(); toggleMark(editor, "bold"); break;
        case "i": event.preventDefault(); toggleMark(editor, "italic"); break;
        case "u": event.preventDefault(); toggleMark(editor, "underline"); break;
      }
    },
    [editor],
  );

  // ─── Mouse selection → temp highlight ────────────────────────────────────────

  const handleMouseUp = () => {
    if (!isShowComments) return;

    const { selection: slateSelection } = editor;
    if (!slateSelection || Range.isCollapsed(slateSelection)) return;

    const selectedText = Editor.string(editor, slateSelection);
    if (!selectedText.trim()) return;

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) return;

    const domRange = domSelection.getRangeAt(0);
    const clientRects = domRange.getClientRects();
    const lastRect =
      clientRects.length > 0
        ? clientRects[clientRects.length - 1]
        : domRange.getBoundingClientRect();

    setSelection({
      text: selectedText,
      position: { left: lastRect.right, top: lastRect.bottom },
    });

    setActiveRange(slateSelection);
  };

  // ─── Submit comment ───────────────────────────────────────────────────────────

  const sendComment = useCallback(
    (text: string) => {
      const range = activeSpanRef.current;
      if (!range || !selection) return;

      const commentId = uuid();
      addCommentMark(range, commentId);

      const newComment: any = {
        id: commentId,
        comment: text,
        time: new Date().toISOString(),
        range,
        text: selection.text,
        position: selection.position,
      };

      setStoredComments((prev) => [...prev, newComment]);

      dispatch(addComments({
        commentType: "comment",
        commentId: "",
        jobId: artifactJobID || "",
        createdById: usersDetails?.id,
        userType: "",
        comment: text,
        rowIndex: selection?.rowIndex,
        colField: selection?.colField,
        range,
        text: selection.text,
        position: selection.position,
      }));

      setSelection(null);
      setActiveRange(null);
      Transforms.deselect(editor);
    },
    [selection, artifactJobID, addCommentMark, editor, setActiveRange],
  );

  // ─── Decorate: temp highlight only ───────────────────────────────────────────

  const decorate = useCallback(
    ([node, path]: any) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      if (tempRange) {
        const intersection = Range.intersection(tempRange, {
          anchor: { path, offset: 0 },
          focus: { path, offset: node.text.length },
        });
        if (intersection) {
          ranges.push({ ...intersection, isTempHighlight: true });
        }
      }

      return ranges;
    },
    [tempRange],
  );

  // ─── Click-outside / Escape closes floating toolbar ──────────────────────────

  useEffect(() => {
    if (!selection) return;
    const handleMouseDown = (e: MouseEvent) => {
      const toolbar = document.getElementById("floating-toolbar");
      if (toolbar && !toolbar.contains(e.target as Node)) {
        setSelection(null);
        setActiveRange(null);
        window.getSelection()?.removeAllRanges();
        Transforms.deselect(editor);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [selection, editor, setActiveRange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(null);
        setActiveRange(null);
        window.getSelection()?.removeAllRanges();
        Transforms.deselect(editor);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editor, setActiveRange]);

  // ─── Sidebar: scroll-to + activate comment ────────────────────────────────────

  const activeCommentFunction = (commentId: string | undefined) => {
    setActiveCommentId(commentId);
    if (!commentId) return;

    const target = storedComments.find((c: any) => c.id === commentId);
    if (target?.range) {
      try {
        ReactEditor.focus(editor);
        Transforms.select(editor, target.range);
        const domRange = ReactEditor.toDOMRange(editor, target.range);
        domRange.startContainer.parentElement?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        Transforms.deselect(editor);
        window.getSelection()?.removeAllRanges();
      } catch (e) {
        console.warn("Could not scroll to comment range", e);
      }
    }

    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${commentId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        className={clsx(
          styles.editorContainer,
          isShowComments && styles.editorWithComments,
        )}
      >
        <div className={styles.editorArea}>
          <Slate editor={editor} initialValue={editorValue} onChange={handleChange}>
            {!mode && (
              <Toolbar
                onClickSaveBtn={onClickSaveBtn ? handleSave : undefined}
                buttonLabel="Save"
                onDiscard={onDiscard ? handleDiscard : undefined}
                hideFontActions={hideFontActions}
                hideIndentActions={hideIndentActions}
                hideAlignmentActions={hideAlignmentActions}
              />
            )}
            <Editable
              renderLeaf={renderLeaf}
              renderElement={renderElement}
              readOnly={readOnly}
              decorate={decorate}
              onKeyDown={handleKeyDown}
              onMouseUp={handleMouseUp}
              className={clsx(styles.editableArea, className)}
            />
          </Slate>

          {selection && (
            <FloatingCommentToolbar
              position={selection.position}
              onAddComment={(text) => {
                if (activeSpanRef.current) sendComment(text);
              }}
            />
          )}
        </div>

        {isShowComments && (
          <CommentSidebar
            comments={storedComments}
            setComments={setStoredComments}
            onCommentsWindowClose={onCommentsWindowClose}
            artifactJobID={artifactJobID}
            activeCommentId={activeCommentId}
            setActiveCommentId={setActiveCommentId}
            activeCommentFunction={activeCommentFunction}
          />
        )}
      </div>
    </>
  );
};

export default SlateContentEditor;
