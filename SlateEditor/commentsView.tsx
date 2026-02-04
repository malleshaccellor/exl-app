
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
  replies?: repliesType[];
};

export type repliesType = {
  id: string;
  text: string;
  createdAt: string;
  useId: string;
};

export type selectionType = {
  position: {
    left: number | string;
    top: number | string;
  };
  rowIndex: number;
  colField: string;
  text: string;
};

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
  const [showCommentBox, setShowCommentBox] = useState<boolean | undefined>(
    showComments,
  );
  const [storedComments, setStoredComments] = useState<storedCommentsType[]>(
    [],
  );
  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();
  const containerRef = useRef<HTMLDivElement>(
    null,
  ) as React.RefObject<HTMLDivElement>;
  const getCommentsData = useAppSelector((state) => state.comments.comments);
  const uploadCommentData = useAppSelector(
    (state) => state.comments.addComment,
  );

  useEffect(() => {
    dispatch(fetchComments(userStoryJobId));
  }, [uploadCommentData?.data]);

  useEffect(() => {
    if (getCommentsData?.jobId !== userStoryJobId) {
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
      comment: com.comment,
      time: com.createdAt,

      replies: com.replies.map((reply: repliesType) => ({
        id: reply?.id,
        text: reply?.text,
        createdAt: reply?.createdAt,
        useId: reply?.useId,
      })),
    }));
    setStoredComments(existingComments);
  }, [getCommentsData, userStoryJobId]);

  useEffect(() => {
    setSelection(null);
    setShowCommentBox(false);
  }, [rows]);

  const handleMouseUp = (rowIndex: any, colField: any) => {
    if (!showComments) return;
    const selectedText = window.getSelection()?.toString();

    if (!selectedText?.trim()) return;

    const range = window.getSelection()?.getRangeAt(0);
    const rect = range?.getBoundingClientRect();

    setSelection({
      rowIndex,
      colField,
      text: selectedText,
      position: {
        top: rect?.top || "" + window.scrollY,
        left: rect?.right || "" + window.scrollX,
      },
    });
  };

  if (!rows?.length) return null;
  const cols = columns ?? default_columns;

  const usersDetails = useAppSelector((state) => state.users.userDetails);

  const sendComment = (text: string) => {
    if (!selection) return;

    const comment: storedCommentsType = {
      position: selection.position,
      rowIndex: selection.rowIndex,
      text: selection.text,
      colField: selection.colField,
      comment: text,
      time: new Date().toISOString(),
    };

    setStoredComments((prev) => [...prev, comment]);

    const addCommentPayload = {
      commentType: "comment",
      commentId: "",
      jobId: userStoryJobId || "",
      createdById: usersDetails && usersDetails.id,
      userType: "",
      comment: text,
      rowIndex: selection.rowIndex,
      colField: selection.colField,
      text: selection.text,
      position: {
        left: selection.position.left,
        top: selection.position.top,
      },
    };
    dispatch(addComments(addCommentPayload));
  };

  const highlightText = (text: string, highlights: any, comId) => {
    if (!highlights.length) return text;
    let result = text;
    highlights.forEach((h) => {
      if (!h.text) return;
      const isActive = h.id === comId;
      const classname = isActive
        ? "comment-highlight-active"
        : "comment-highlight";
      const regex = new RegExp(`(${h.text})`, "gi");
      result = result.replace(
        regex,
        `<mark class=${styles[classname]}>$1</mark>`,
      );
    });
    return result;
  };

  return (
    <>
      <TableContainer className={styles.tableContainer} sx={{ minHeight: "60vh", maxHeight: "calc(100vh - 320px)" }}>
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
                        onBlur={(e) => {
                          onCellChange?.(
                            idx,
                            col.key,
                            e.currentTarget.textContent,
                          );
                        }}
                        style={{
                          outline: "none",
                          display: "block",
                        }}
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
                      {showComments ? (
                        <span
                          dangerouslySetInnerHTML={{
                            __html: highlightText(
                              normalizeValue(row?.[col.key]),
                              storedComments.filter(
                                (c) =>
                                  c.rowIndex === idx && c.colField === col.key,
                              ),
                              activeCommentId,
                            ),
                          }}
                        />
                      ) : (
                        normalizeValue(row?.[col.key])
                      )}
                    </TableCell>
                  ),
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
          onAddComment={(text) => {
            if (!selection) return;
            sendComment(text);
          }}
        />
      )}
    </>
  );
};
