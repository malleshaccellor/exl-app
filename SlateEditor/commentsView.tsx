import { useEffect, useRef, useState } from "react";
import CommentSidebar from "../SlateEditor/CommentSidebar";
import FloatingCommentToolbar from "../SlateEditor/FloatingCommentToolbar";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  addComments,
  fetchComments,
} from "../../store/reducer/comments/action";
import styles from "./output-generation.module.css";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";

/* ---------------------------------- */
/* Helpers */
/* ---------------------------------- */

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

/* ---------------------------------- */
/* Types */
/* ---------------------------------- */

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
    left: number | string;
    top: number | string;
  };
  rowIndex: number;
  colField: string;
  text: string;
  comment: string;
  time: any;
};

export type selectionType = {
  position: {
    left: number;
    top: number;
  };
  rowIndex: number;
  colField: string;
  text: string;
};

/* ---------------------------------- */
/* Component */
/* ---------------------------------- */

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

  const [selection, setSelection] = useState<selectionType | null>(null);
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();

  const containerRef = useRef<HTMLDivElement>(null);
  const activeSpanRef = useRef<HTMLSpanElement | null>(null);

  const getCommentsData = useAppSelector((state) => state.comments.comments);
  const uploadCommentData = useAppSelector(
    (state) => state.comments.addComment
  );
  const usersDetails = useAppSelector((state) => state.users.userDetails);

  /* ---------------------------------- */
  /* Fetch comments */
  /* ---------------------------------- */

  useEffect(() => {
    dispatch(fetchComments(userStoryJobId));
  }, [uploadCommentData?.data]);

  useEffect(() => {
    if (getCommentsData?.jobId !== userStoryJobId) {
      setStoredComments([]);
      return;
    }

    setStoredComments(
      getCommentsData?.data.map((com) => ({
        id: com.id,
        position: com.position,
        rowIndex: com.rowIndex,
        colField: com.colField,
        text: com.text,
        comment: com.comment,
        time: com.createdAt,
      }))
    );
  }, [getCommentsData, userStoryJobId]);

  /* ---------------------------------- */
  /* Selection + Highlight Logic */
  /* ---------------------------------- */

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

    // Wrap selected text in temporary span
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

  /* ---------------------------------- */
  /* Add Comment */
  /* ---------------------------------- */

  const sendComment = (text: string) => {
    if (!selection || !activeSpanRef.current) return;

    // Convert active highlight → permanent
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

  /* ---------------------------------- */
  /* Escape = cancel */
  /* ---------------------------------- */

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

  /* ---------------------------------- */
  /* Render */
  /* ---------------------------------- */

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
                {cols.map((col) => (
                  <TableCell
                    key={col.key}
                    onMouseUp={() => handleMouseUp(idx, col.key)}
                    style={{
                      cursor: showComments ? "text" : "default",
                      userSelect: showComments ? "text" : "none",
                    }}
                  >
                    {normalizeValue(row?.[col.key])}
                  </TableCell>
                ))}
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
          onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
        />
      )}
    </>
  );
};
