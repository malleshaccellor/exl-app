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
  updateComments,
} from "../../store/reducer/comments/action";
import FloatingCommentToolbar from "../FloatingCommentToolbar";
import { v4 as uuid } from "uuid";
import api from "../../api/api";
import config from "../../api/comments/config";

interface SlateEditorProps {
  value?: Descendant[];
  defaultValue?: Descendant[];
  onChange?: (value: Descendant[]) => void;
  isPreview?: boolean;
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
  isPreview,
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
}: SlateEditorProps) => {
  const dispatch = useAppDispatch();
  const editor = useMemo(
    () => withTables(withHistory(withReact(createEditor()))),
    [],
  );
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>(
    [],
  );

  const usersDetails = useAppSelector((state) => state.users.userDetails);
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [tempRange, setTempRange] = useState<Range | null>(null);
  const activeSpanRef = useRef<Range | null>(null);

  const getCommentsData = useAppSelector((state) => state.comments.comments);

  const setActiveRange = useCallback((range: Range | null) => {
    activeSpanRef.current = range;
    setTempRange(range);
  }, []);
  const addCommentMark = useCallback(
    (range: Range, commentId: string) => {
      // This physically adds the ID to the JSON node in the document
      Transforms.setNodes(editor, { commentId } as any, {
        at: range,
        match: (n) => Text.isText(n),
        split: true, // This cuts the text node so only the selected part has the ID
      });
    },
    [editor],
  );

  const getPathById = (editor: Editor, id: string) => {
    // Generator that scans all nodes in the document
    const nodes = Editor.nodes(editor, {
      at: [],
      match: (n) => Text.isText(n) && (n as any).commentId === id,
    });

    for (const [node, path] of nodes) {
      return path; // Return the first matching path found
    }
    return null;
  };

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

  useEffect(() => {
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, []);

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
    if (artifactJobID) dispatch(fetchComments(artifactJobID));
  }, [uploadCommentData?.data]);

  useEffect(() => {
    if (deletedCommentsData?.message === "OK" && artifactJobID)
      dispatch(fetchComments(artifactJobID));
    if (updatedCommentData?.message === "OK" && artifactJobID)
      dispatch(fetchComments(artifactJobID));
  }, [deletedCommentsData, updatedCommentData]);

  useEffect(() => {
    if (getCommentsData?.jobId !== artifactJobID) {
      storedComments?.forEach((c: any) => removeCommentMark(c.id));
      setStoredComments([]);
      return;
    }

    const existingComments = getCommentsData?.data?.map((com) => ({
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
      replies: com.replies?.map((reply: repliesType) => ({
        id: reply?.id,
        text: reply?.text,
        createdAt: reply?.createdAt,
        useId: reply?.useId,
      })),
    }));

    const incomingIds = new Set(existingComments?.map((c: any) => c.id));
    storedComments?.forEach((prev: any) => {
      if (!incomingIds.has(prev.id)) removeCommentMark(prev.id);
    });

    existingComments?.forEach((c: any) => {
      if (c.range) {
        try {
          addCommentMark(c.range, c.id);
        } catch {
          /* stale range */
        }
      }
    });

    setStoredComments(existingComments);
  }, [getCommentsData, artifactJobID]);

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

  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) setInternalValue(val);
      onChange?.(val);
    },
    [value, onChange],
  );

  // const handleSave = useCallback(() => {
  //   onSaveRef.current?.(editor.children);
  // }, [editor]);

  const handleSave = useCallback(async () => {
    const currentContent = editor.children;

    if (!storedComments || storedComments.length === 0) {
      onSaveRef.current?.(currentContent);
      return;
    }

    try {
      // 1. Map comments to the new array payload format
      const commentsPayload = storedComments?.reduce((acc: any[], com: any) => {
        const nodeEntries = Array.from(
          Editor.nodes(editor, {
            at: [],
            match: (n) => Text.isText(n) && (n as any).commentId === com.id,
          }),
        );

        // Skip if the comment was deleted from the editor
        if (nodeEntries.length === 0) return acc;

        const startPoint = Editor.start(editor, nodeEntries[0][1]);
        const endPoint = Editor.end(
          editor,
          nodeEntries[nodeEntries.length - 1][1],
        );
        const currentText = nodeEntries
          .map(([node]) => (node as Text).text)
          .join("");

        acc.push({
          id: com.id,
          comment: com.comment,
          isResolved: com.isResolved || false, // Adjust based on your data shape
          viewFlag: com.viewFlag || true,
          text: currentText,
          range: { anchor: startPoint, focus: endPoint },
        });

        return acc;
      }, []);

      console.log("Comments Pay", commentsPayload);

      // 2. Dispatch the single bulk update API call
      if (commentsPayload.length > 0) {
        await api.post(`${config.BulkCommentUpdate}`, {
          comments: commentsPayload,
        });
      }

      // 3. Finalize global save
      onSaveRef.current?.(currentContent);
      console.log("Success: All comments synchronized in one batch.");
    } catch (error) {
      console.error("Bulk save error:", error);
    }
  }, [editor, storedComments, dispatch]);

  const handleDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);

  const renderLeaf = useCallback(({ attributes, children, leaf }: any) => {
    if (leaf.bold) children = <strong>{children}</strong>;
    if (leaf.italic) children = <em>{children}</em>;
    if (leaf.underline) children = <u>{children}</u>;
    if (leaf.strikethrough) children = <s>{children}</s>;
    if (leaf.code) children = <code>{children}</code>;

    if (leaf.isTempHighlight) {
      children = <span className={styles.commentSelection}>{children}</span>;
    }

    if (leaf.commentId) {
      children = (
        <mark
          data-comment-id={leaf.commentId}
          className={clsx(
            styles.commentHighlight,
            leaf.isActive && styles.commentHighlightActive,
          )}
        >
          {children}
        </mark>
      );
    }

    return <span {...attributes}>{children}</span>;
  }, []);

  const CollapsibleQuote = ({ attributes, children, style, className }: any) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
      <blockquote
        {...attributes}
        style={{
          borderLeft: "3px solid #ccc",
          ...style,
          paddingLeft: style?.paddingLeft || "12px",
        }}
        className={className}
      >
        <div
          contentEditable={false}
          onClick={() => setIsExpanded(!isExpanded)}
          className={styles.citationButton}
        >
          {isExpanded ? "▼ Hide Details" : "▶ Show Details"}
        </div>

        <div style={{ display: isExpanded ? "block" : "none" }}>{children}</div>
      </blockquote>
    );
  };

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
            <CollapsibleQuote
              attributes={attributes}
              children={children}
              style={style}
              className={element.className || "block-quote"}
            />
          );
        case "code-block":
          return (
            <pre
              {...attributes}
              style={{ background: "#f5f5f5", padding: 12, ...style }}
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
          return element.isHeader ? (
            <th {...attributes} style={style}>
              {children}
            </th>
          ) : (
            <td {...attributes} style={style}>
              {children}
            </td>
          );
        case "paragraph":
          return (
            <p
              {...attributes}
              style={style}
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

    const boxHeight = 95;
    const padding = 10;
    const boxWidth = 250;
    const spaceRight = window.innerWidth - lastRect.right;
    const spaceBelow = window.innerHeight - lastRect.bottom;
    const topPosition =
      spaceBelow < boxHeight + padding
        ? lastRect.top - boxHeight - padding
        : lastRect.bottom + padding;

    const leftPosition =
      spaceRight < boxWidth + padding
        ? lastRect.left - boxWidth - padding
        : lastRect.right + padding;

    setSelection({
      text: selectedText,
      position: {
        left: leftPosition,
        top: topPosition,
      },
    });

    setActiveRange(slateSelection);
  };

  // ─── Submit comment ──────────────────────────────────────────────────────────

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

      dispatch(
        addComments({
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
        }),
      );

      setSelection(null);
      setActiveRange(null); // clears ref + tempRange → removes temp highlight
      Transforms.deselect(editor);
    },
    [selection, artifactJobID, addCommentMark, editor, setActiveRange],
  );

  const decorate = useCallback(
    ([node, path]: any) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      if (isShowComments && node.commentId) {
        ranges.push({
          anchor: { path, offset: 0 },
          focus: { path, offset: node.text.length },
          commentId: node.commentId,
          isActive: node.commentId === activeCommentId,
        });
      }

      if (tempRange && isPreview) {
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
    [tempRange, activeCommentId, isPreview, isShowComments],
  );

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

  const activeCommentFunction = (commentId: string | undefined) => {
    setActiveCommentId(commentId);
    if (!commentId) return;

    const currentPath = getPathById(editor, commentId);

    if (currentPath) {
      try {
        ReactEditor.focus(editor);
        const node = Node.get(editor, currentPath) as any;
        const newRange = {
          anchor: { path: currentPath, offset: 0 },
          focus: { path: currentPath, offset: node.text?.length || 0 },
        };

        Transforms.select(editor, newRange);

        setTimeout(() => {
          // 1. Try to find the element by the ID we stamped in RenderLeaf
          const targetEl = document.querySelector(
            `[data-comment-id="${commentId}"]`,
          ) as HTMLElement;

          if (targetEl) {
            // 2. Use 'block: "center"' to ensure it moves regardless of direction
            targetEl.scrollIntoView({
              behavior: "smooth",
              block: "center", // This forces both Up-to-Down and Down-to-Up
              inline: "nearest",
            });
          } else {
            // 3. Fallback for Slate Tables/Complex docs: Use the Range
            try {
              const domRange = ReactEditor.toDOMRange(editor, newRange);
              domRange.startContainer.parentElement?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            } catch (e) {
              console.warn("Manual scroll fallback failed");
            }
          }
        }, 100);
      } catch (err) {
        console.warn("Selection failed", err);
      }
    }

    // Sidebar scroll
    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${commentId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
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
        <div
          className={clsx(
            styles.editorArea,
            isShowComments && styles.commentsVisible,
            !isPreview && styles.editView,
          )}
        >
          <Slate
            editor={editor}
            initialValue={editorValue}
            onChange={handleChange}
          >
            {!isPreview && (
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
              readOnly={isPreview}
              decorate={decorate}
              onKeyDown={handleKeyDown}
              onMouseUp={handleMouseUp}
              className={clsx(styles.editableArea, className)}
            />
          </Slate>
          {selection && isPreview && (
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
