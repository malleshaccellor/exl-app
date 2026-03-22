import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { createEditor, Editor, type Descendant ,Text} from "slate";
import {
  createEditor,
  type Descendant,
  Editor,
  Range,
  Transforms,
  Text,
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
  artifactJobID?: string;
  mode?: boolean;
}
interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  resolved: boolean;
  replies: any[];
  range: any; // Slate Range
  selectedText: string;
}
interface EditorSelection {
  text: string;
  position: {
    top: number;
    left: number;
  };
  rowIndex?: number | string; // Added to match your payload
  colField?: string; // Added to match your payload
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
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>(
    [],
  );

  // const [storedComments, setStoredComments] = useState<any[]>(() => {
  //   const saved = localStorage.getItem("editor-comments");
  //   return saved ? JSON.parse(saved) : [];
  // });
  const usersDetails = useAppSelector((state) => state.users.userDetails);

  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const activeSpanRef = useRef<Range | null>(null);

  const getCommentsData = useAppSelector((state) => state.comments.comments);
  const addCommentMark = (editor: Editor, range: Range, commentId: string) => {
    // 1. Force the selection to the comment range
    Transforms.select(editor, range);

    // 2. Apply the mark and split the nodes at the range boundaries
    // This ensures a new 'leaf' is created specifically for this comment
    Transforms.setNodes(
      editor,
      { commentId },
      {
        at: range,
        match: (n) => Text.isText(n),
        split: true, // CRITICAL: This forces Slate to create a separate leaf for the highlight
      },
    );

    // 3. Deselect to remove the browser's native blue highlight
    Transforms.deselect(editor);
  };
  const removeCommentMark = (editor: Editor, commentId: string): void => {
    const nodes = Array.from(
      Editor.nodes(editor, {
        at: [],
        match: (n) => Text.isText(n) && (n as any).commentId === commentId,
      }),
    );

    for (const [, path] of nodes) {
      Transforms.unsetNodes(editor, "commentId", { at: path });
    }
  };

  useEffect(() => {
    if (artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, []);

  useEffect(() => {
    if (getCommentsData?.jobId !== artifactJobID) {
      setStoredComments([]);
      return;
    }
    const existingComments = getCommentsData?.data.map((com) => ({
      id: com.id,
      position: {
        left: com.position.left,
        top: com.position.top,
      },
      rowIndex: com.rowIndex,
      colField: com.colField,
      text: com.text,
      range: com.range, // The Slate Range {anchor, focus} from API
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
    setStoredComments(existingComments);
  }, [getCommentsData, artifactJobID]);
  const deletedCommentsData = useAppSelector(
    (state) => state.comments.deleteComment,
  );

  const updatedCommentData = useAppSelector(
    (state) => state.comments.updateComment,
  );
  const uploadCommentData = useAppSelector(
    (state) => state.comments.addComment,
  );
  useEffect(() => {
    if (artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, [uploadCommentData?.data]);
  useEffect(() => {
    if (deletedCommentsData?.message === "OK" && artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
    if (updatedCommentData?.message === "OK" && artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, [deletedCommentsData, updatedCommentData]);

  // Keep callbacks in refs to avoid stale closures
  const onSaveRef = useRef(onClickSaveBtn);
  onSaveRef.current = onClickSaveBtn;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const computedDefault = useMemo(() => {
    if (data) return jsonToSlateValue(data);
    return defaultValue;
  }, [data, defaultValue]);

  const [internalValue, setInternalValue] =
    useState<Descendant[]>(computedDefault);
  const editorValue = useMemo(
    () => value ?? internalValue,
    [value, internalValue],
  );

  // const handleChange = useCallback(
  //   (val: Descendant[]) => {
  //     if (!value) {
  //       setInternalValue(val);
  //     }
  //     onChange?.(val);
  //   },
  //   [value, onChange],
  // );
  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) {
        setInternalValue(val);
      }

      onChange?.(val);
    },
    [value, onChange],
  );

  const handleSave = useCallback(() => {
    onSaveRef.current?.(editor.children);
  }, [editor]);

  const handleDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);

  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      if (leaf.bold) children = <strong>{children}</strong>;
      if (leaf.italic) children = <em>{children}</em>;
      if (leaf.underline) children = <u>{children}</u>;
      if (leaf.strikethrough) children = <s>{children}</s>;
      if (leaf.code) children = <code>{children}</code>;

      if (leaf.isTempHighlight) {
        children = (
          <span {...attributes} className={styles.commentSelection}>
            {children}
          </span>
        );
      }

      if (leaf.commentId) {
        const isActive = leaf.isActive;

        children = (
          <mark
            {...attributes}
            className={clsx(
              styles.commentHighlight,
              isActive && styles.activeHighlight,
            )}
          >
            {children}
          </mark>
        );
      }

      return <span {...attributes}>{children}</span>;
    },
    [activeCommentId],
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
          return (
            <h1 {...attributes} style={style}>
              {children}
            </h1>
          );
        case "heading-two":
          return (
            <h2 {...attributes} style={style}>
              {children}
            </h2>
          );
        case "heading-three":
          return (
            <h3 {...attributes} style={style}>
              {children}
            </h3>
          );
        case "heading-four":
          return (
            <h4 {...attributes} style={style}>
              {children}
            </h4>
          );
        case "heading-five":
          return (
            <h5
              {...attributes}
              style={style}
              className={element.className || "heading-five"}
            >
              {children}
            </h5>
          );
        case "heading-six":
          return (
            <h6 {...attributes} style={style}>
              {children}
            </h6>
          );
        case "bulleted-list":
          return (
            <ul {...attributes} style={style}>
              {children}
            </ul>
          );
        case "numbered-list":
          return (
            <ol {...attributes} style={style}>
              {children}
            </ol>
          );
        case "list-item":
          return (
            <li {...attributes} style={style}>
              {children}
            </li>
          );

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
            <pre
              {...attributes}
              style={{
                background: "#f5f5f5",
                padding: 12,
                ...style,
              }}
            >
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
          return (
            <tr {...attributes} style={style}>
              {children}
            </tr>
          );
        case "table-cell-header":
          return (
            <th {...attributes} style={style}>
              {children}
            </th>
          );
        case "table-cell":
          if (element.isHeader) {
            return (
              <th {...attributes} style={style}>
                {children}
              </th>
            );
          }
          return (
            <td {...attributes} style={style}>
              {children}
            </td>
          );
        case "paragraph":
          return (
            <p
              {...attributes}
              style={{ ...style }}
              className={element.className || "paragraph"}
            >
              {children}
            </p>
          );
        default:
          return (
            <p
              {...attributes}
              style={style}
              className={element.className || "paragraph"}
            >
              {children}
            </p>
          );
      }
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      switch (event.key) {
        case "b":
          event.preventDefault();
          toggleMark(editor, "bold");
          break;
        case "i":
          event.preventDefault();
          toggleMark(editor, "italic");
          break;
        case "u":
          event.preventDefault();
          toggleMark(editor, "underline");
          break;
      }
    },
    [editor],
  );

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isShowComments) return;

    // Get the Slate selection instead of DOM selection
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
      position: {
        left: lastRect.right,
        top: lastRect.bottom,
      },
    });

    // Store the SLATE selection, not the DOM range
    activeSpanRef.current = slateSelection;
  };

  const sendComment = useCallback(
    (text: string) => {
      const range = activeSpanRef.current;
      if (!range || !selection) return;

      const commentId = uuid();

      const newComment = {
        id: commentId,
        comment: text,
        time: new Date().toISOString(),
        range,
        selectedText: selection.text,
      };

      setStoredComments((prev) => {
        const updated = [...prev, newComment];
        return updated;
      });
      const addCommentPayload: any = {
        commentType: "comment",
        commentId: "",
        jobId: artifactJobID || "",
        createdById: usersDetails && usersDetails.id,
        userType: "",
        comment: text,
        rowIndex: selection?.rowIndex,
        colField: selection?.colField,
        range: range,
        text: selection.text,
        position: {
          left: selection.position.left,
          top: selection.position.top,
        },
      };
      dispatch(addComments(addCommentPayload));

      // Clean up UI
      setSelection(null);
      activeSpanRef.current = null;
      Transforms.deselect(editor);
    },
    [selection, artifactJobID],
  );

  const decorate = useCallback(
    ([node, path]: any) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      if (activeSpanRef.current) {
        const intersection = Range.intersection(activeSpanRef.current, {
          anchor: { path, offset: 0 },
          focus: { path, offset: node.text.length },
        });
        if (intersection)
          ranges.push({ ...intersection, isTempHighlight: true });
      }
      
      if (isShowComments) {
        storedComments.forEach((comment: any) => {
          if (comment.range) {
            const intersection = Range.intersection(comment.range, {
              anchor: { path, offset: 0 },
              focus: { path, offset: node.text.length },
            });

            if (intersection) {
              ranges.push({
                ...intersection,
                commentId: comment.id,
                isActive: comment.id === activeCommentId,
              });
            }
          }
        });
      }

      return ranges;
    },
    [storedComments, activeCommentId, selection, isShowComments],
  );

  useEffect(() => {
    if (!selection) return;

    const handleMouseDown = (e: MouseEvent) => {
      const toolbar = document.getElementById("floating-toolbar");

      // If we click outside the toolbar
      if (toolbar && !toolbar.contains(e.target as Node)) {
        // 1. Remove the Toolbar
        setSelection(null);

        // 2. CRITICAL: Clear the Ref to remove the Light Blue highlight
        activeSpanRef.current = null;

        // 3. FIX DOUBLE-CLICK: Clear the browser's blue ghost selection
        window.getSelection()?.removeAllRanges();

        // 4. Force Slate to deselect
        Transforms.deselect(editor);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [selection, editor]); // Add editor to dependencies

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(null);
        activeSpanRef.current = null;
        window.getSelection()?.removeAllRanges();
        Transforms.deselect(editor);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeCommentFunction = (commentId: string | undefined) => {
    setActiveCommentId(commentId);

    if (!commentId) return;
    const target = storedComments.find((c: any) => c.id === commentId);

    if (target?.range) {
      try {
        // 3. Focus and select the text in Slate
        ReactEditor.focus(editor);
        Transforms.select(editor, target.range);

        // 4. Scroll the Slate editor to the text
        const domRange = ReactEditor.toDOMRange(editor, target.range);
        domRange.startContainer.parentElement?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } catch (e) {
        console.warn("Could not scroll to comment range", e);
      }
    }

    // 5. Scroll the sidebar (existing logic)
    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${commentId}`);
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    });
  };

  return (
    <>
      <div
        className={clsx(
          styles.editorContainer,
          isShowComments && styles.editorWithComments,
        )}
      >
        <div className={styles.editorArea}>
          <Slate
            editor={editor}
            initialValue={editorValue}
            onChange={handleChange}
          >
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
                if (activeSpanRef.current) {
                  sendComment(text);
                  setSelection(null);
                }
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
