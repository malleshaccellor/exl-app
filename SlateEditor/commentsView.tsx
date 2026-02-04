import { useEffect, useRef, useState } from "react";
import CommentSidebar from "../SlateEditor/CommentSidebar";
import FloatingCommentToolbar from "../SlateEditor/FloatingCommentToolbar";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addComments, fetchComments } from "../../store/reducer/comments/action";
import styles from "./output-generation.module.css";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";

/* -------------------- helpers -------------------- */

const default_columns = [
  { key: "Action_Item", label: "Action" },
  { key: "Requestor", label: "Requestors" },
  { key: "Owner", label: "Owner" },
  { key: "Status", label: "Status" },
  { key: "Priority", label: "Priority" },
  { key: "Start_Date", label: "Start Date" },
  { key: "Due_Date", label: "Due Date" },
  { key: "Comments", label: "Comments" },
];

const normalizeValue = (val: any) => {
  if (val === null || val === undefined) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return JSON.stringify(val);
};

/* -------------------- types -------------------- */

type ActionLogTableProps = {
  rows: Record<string, any>[];
  columns?: { key: string; label: string }[];
  showComments?: boolean;
  isEditing?: boolean;
  onCommentsWindowClose?: () => void;
  onCellChange?: (rowIndex: number, colKey: string, value: string) => void;
  userStoryJobId?: string;
};

export type storedCommentsType = {
  id?: string;
  position: {
    left: number;
    top: number;
  };
  rowIndex: number;
  colField: string;
  text: string;
  comment: string;
  time: string;
};

type SelectionState = {
  position: {
    left: number;
    top: number;
  };
  rowIndex: number;
  colField: string;
  text: string;
};

/* -------------------- highlightText -------------------- */

const highlightText = (
  text: string,
  highlights: storedCommentsType[],
  activeId?: string
) => {
  if (!highlights || !highlights.length) return text;

  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;

  // Build regex from all highlighted texts
  const regexParts = highlights.map((h) => h.text).filter(Boolean);
  if (!regexParts.length) return text;

  const regex = new RegExp(`(${regexParts.join("|")})`, "gi");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchText = match[0];
    const matchStart = match.index;

    if (matchStart > lastIndex) {
      parts.push(text.slice(lastIndex, matchStart));
    }

    const highlight = highlights.find(
      (h) => h.text.toLowerCase() === matchText.toLowerCase()
    );

    if (highlight) {
      const isActive = highlight.id === activeId;
      const className = isActive
        ? styles["comment-highlight-active"]
        : styles["comment-highlight"];

      parts.push(
        <mark key={matchStart} className={className}>
          {matchText}
        </mark>
      );
    } else {
      parts.push(matchText);
    }

    lastIndex = matchStart + matchText.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
};

/* -------------------- component -------------------- */

export const ActionLogTable = ({
  rows,
  columns,
  onCellChange,
  isEditing,
  showComments,
  userStoryJobId,
  onCommentsWindowClose,
}: ActionLogTableProps) => {
  const dispatch = useAppDispatch();

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeSpanRef = useRef<HTMLSpanElement | null>(null);

  const commentsState = useAppSelector((state) => state.comments.comments);
  const addCommentState = useAppSelector((state) => state.comments.addComment);
  const usersDetails = useAppSelector((state) => state.users.userDetails);

  /* -------------------- fetch comments -------------------- */

  useEffect(() => {
    if (userStoryJobId) {
      dispatch(fetchComments(userStoryJobId));
    }
  }, [dispatch, userStoryJobId, addCommentState?.data]);

  useEffect(() => {
    if (commentsState?.jobId !== userStoryJobId) {
      setStoredComments([]);
      return;
    }

    setStoredComments(
      commentsState?.data.map((com: any) => ({
        id: com.id,
        position: com.position,
        rowIndex: com.rowIndex,
        colField: com.colField,
        text: com.text,
        comment: com.comment,
        time: com.createdAt,
      })) || []
    );
  }, [commentsState, userStoryJobId]);

  /* -------------------- selection helpers -------------------- */

  const clearActiveSpan = () => {
    if (!activeSpanRef.current) return;
    const span = activeSpanRef.current;
    span.replaceWith(document.createTextNode(span.textContent || ""));
    activeSpanRef.current = null;
  };

  const handleMouseUp = (rowIndex: number, colField: string) => {
    if (!showComments) return;

    const selectionObj = window.getSelection();
    if (!selectionObj || selectionObj.rangeCount === 0) return;

    const range = selectionObj.getRangeAt(0);
    const selectedText = range.toString();

    if (!selectedText.trim()) return;

    clearActiveSpan();

    const span = document.createElement("span");
    span.className = styles["comment-highlight-active"];
    span.textContent = selectedText;

    range.deleteContents();
    range.insertNode(span);
    activeSpanRef.current = span;

    const rect = span.getBoundingClientRect();
    const OFFSET = 8;

    setSelection({
      rowIndex,
      colField,
      text: selectedText,
      position: {
        left: rect.right + window.scrollX + OFFSET,
        top: rect.top + rect.height / 2 + window.scrollY,
      },
    });

    selectionObj.removeAllRanges();
  };

  /* -------------------- add comment -------------------- */

  const sendComment = (text: string) => {
    if (!selection || !activeSpanRef.current) return;

    activeSpanRef.current.className = styles["comment-highlight"];

    const comment: storedCommentsType = {
      position: selection.position,
      rowIndex: selection.rowIndex,
      colField: selection.colField,
      text: selection.text,
      comment: text,
      time: new Date().toISOString(),
    };

    setStoredComments((prev) => [...prev, comment]);

    dispatch(
      addComments({
        commentType: "comment",
        commentId: "",
        jobId: userStoryJobId || "",
        createdById: usersDetails?.id,
        userType: "",
        comment: text,
        rowIndex: selection.rowIndex,
        colField: selection.colField,
        text: selection.text,
        position: selection.position,
      })
    );

    activeSpanRef.current = null;
    setSelection(null);
  };

  /* -------------------- escape to cancel -------------------- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearActiveSpan();
        setSelection(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!rows?.length) return null;
  const cols = columns ?? default_columns;

  /* -------------------- render -------------------- */

  return (
    <>
      <TableContainer
        ref={containerRef}
        className={styles.tableContainer}
        sx={{ minHeight: "60vh", maxHeight: "calc(100vh - 320px)" }}
      >
        <Table>
          <TableHead>
            <TableRow>
              {cols.map((col) => (
                <TableCell key={col.key}>{col.label}</TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={idx}>
                {cols.map((col) =>
                  isEditing ? (
                    <TableCell key={col.key}>
                      <span
                        contentEditable={!!onCellChange}
                        suppressContentEditableWarning
                        onBlur={(e) =>
                          onCellChange?.(
                            idx,
                            col.key,
                            e.currentTarget.textContent || ""
                          )
                        }
                        style={{ outline: "none", display: "block" }}
                      >
                        {normalizeValue(row?.[col.key])}
                      </span>
                    </TableCell>
                  ) : (
                    <TableCell
                      key={col.key}
                      onMouseUp={() => handleMouseUp(idx, col.key)}
                      style={{
                        cursor: showComments ? "text" : "default",
                        userSelect: showComments ? "text" : "none",
                      }}
                    >
                      <span>
                        {highlightText(
                          normalizeValue(row?.[col.key]),
                          storedComments.filter(
                            (c) => c.rowIndex === idx && c.colField === col.key
                          ),
                          activeCommentId
                        )}
                      </span>
                    </TableCell>
                  )
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {showComments && (
        <CommentSidebar
          comments={storedComments}
          setComments={setStoredComments}
          onCommentsWindowClose={onCommentsWindowClose}
          userStoryJobId={userStoryJobId}
          activeCommentId={activeCommentId}
          setActiveCommentId={setActiveCommentId}
        />
      )}

      {selection && (
        <FloatingCommentToolbar
          containerRef={containerRef}
          position={selection.position}
          onAddComment={sendComment}
        />
      )}
    </>
  );
};
