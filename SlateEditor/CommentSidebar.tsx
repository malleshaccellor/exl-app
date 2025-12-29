import React, { useState } from "react";
import { ReactEditor } from "slate-react";
import type { Comment } from "./types/types";
import { v4 as uuid } from "uuid";
import scrollToRange from "./utils/scrollToRange";
import { Avatar, IconButton, Menu, MenuItem } from "@mui/material";
import SVG from "react-inlinesvg";
import styles from "./slate-editor.module.css";

type Props = {
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  editor: ReactEditor;
};

export default function CommentSidebar({
  comments,
  setComments,
  editor,
}: Props) {
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [commentMenuAnchor, setCommentMenuAnchor] =
    useState<null | HTMLElement>(null);
  const [replyMenuAnchor, setReplyMenuAnchor] = useState<null | HTMLElement>(
    null
  );
  const [menuCommentId, setMenuCommentId] = useState<string | null>(null);
  const [menuReplyId, setMenuReplyId] = useState<
    [commentId: string, replyId: string] | []
  >([]);
  const [showReply, setShowReply] = useState<string | null>(null);
  const closeMenu = () => {
    setCommentMenuAnchor(null);
    setMenuCommentId(null);
  };

  const closeReplyMenu = () => {
    setReplyMenuAnchor(null);
    setMenuReplyId([]);
  };

  const addReply = (commentId: string) => {
    const text = replyText[commentId];
    if (!text?.trim()) return;

    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              replies: [
                ...c.replies,
                { id: uuid(), text, createdAt: Date.now() },
              ],
            }
          : c
      )
    );

    setReplyText((prev) => ({ ...prev, [commentId]: "" }));
  };

  const deleteComment = (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const deleteReply = (commentId: string, replyId: string) => {
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              replies: c.replies.filter((r) => r.id !== replyId),
            }
          : c
      )
    );
  };

  return (
    <>
      <div className={styles.commentSidebar}>
        <div className={styles.commentSidebarHeader}>
          <div className={styles.commentTitle}>Comments</div>
          <div className={styles.headerActions}>
            <IconButton>
              <SVG src="/icons/editor/ic_filters.svg" width={16} height={16} />
            </IconButton>
            <IconButton>
              <SVG src="/icons/editor/ic_close.svg" width={16} height={16} />
            </IconButton>
          </div>
        </div>
        {comments.length === 0 && (
          <div className={styles.noComments}>No comments yet</div>
        )}
        <div className={styles.commentsList}>
          {comments.map((c) => (
            <div key={c.id} className={styles.commentRow}>
              <div className={styles.commentCard}>
                <div className={styles.commentAuthor}>
                  <Avatar
                    alt={""}
                    src="/icons/ic_avatar.svg"
                    sx={{ width: 24, height: 24 }}
                  />
                  <span className={styles.authorName}>Sara</span>
                  <span className={styles.time}>20 min ago</span>
                  <div className={styles.commentActions}>
                    <IconButton>
                      <SVG src="/icons/editor/ic_reslove.svg" />
                    </IconButton>
                    {/* <IconButton
                      onClick={(e) => {
                        setCommentMenuAnchor(e.currentTarget);
                        setMenuCommentId(c.id);
                      }}
                    >
                      <SVG src="/icons/ic_more.svg" />
                    </IconButton> */}
                  </div>
                </div>
                <div
                  className={styles.commentText}
                  onClick={() => scrollToRange(editor, c.range)}
                >
                  {c.text}
                </div>
                {c.replies.length > 0 && (
                  <div className={styles.repliesSection}>
                    {c.replies.map((r) => (
                      <div key={r.id} className={styles.replyCard}>
                        <div className={styles.commentAuthor}>
                          <Avatar
                            alt={""}
                            src="/icons/ic_avatar.svg"
                            sx={{ width: 24, height: 24 }}
                          />
                          <span className={styles.authorName}>Andy</span>
                          <span className={styles.time}>4 min ago</span>
                          <div className={styles.commentActions}>
                            <IconButton
                              onClick={(e) => {
                                setReplyMenuAnchor(e.currentTarget);
                                setMenuReplyId([c.id, r.id]);
                              }}
                            >
                              <SVG src="/icons/ic_more.svg" />
                            </IconButton>
                          </div>
                        </div>
                        <div className={styles.commentText}>{r.text}</div>
                        {/* <button onClick={() => deleteReply(c.id, r.id)}>
                          Delete reply
                        </button> */}
                      </div>
                    ))}
                  </div>
                )}
                {showReply !== c.id && (
                  <div className={styles.replyButtonContainer}>
                    <IconButton onClick={() => setShowReply(c.id)}>
                      <span>Reply</span>
                      <SVG src="/icons/editor/ic_arrow-up-right.svg" />
                    </IconButton>
                  </div>
                )}
                {showReply === c.id && (
                  <div className={styles.replyInput}>
                    <textarea
                      placeholder="Reply…"
                      name="reply"
                      value={replyText[c.id] || ""}
                      onChange={(e) =>
                        setReplyText((prev) => ({
                          ...prev,
                          [c.id]: e.target.value,
                        }))
                      }
                      rows={1}
                    />
                    <IconButton
                      className={styles.sendButton}
                      onClick={() => {
                        addReply(c.id);
                        setShowReply(null);
                      }}
                    >
                      <SVG src="/icons/editor/ic_send.svg" />
                    </IconButton>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Menu
        anchorEl={commentMenuAnchor}
        open={Boolean(commentMenuAnchor)}
        onClose={closeMenu}
        className={styles.actionMenu}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
      >
        <MenuItem
          onClick={() => {
            if (menuCommentId) deleteComment(menuCommentId);
            closeMenu();
          }}
        >
          Delete Comments
        </MenuItem>
      </Menu>
      <Menu
        anchorEl={replyMenuAnchor}
        open={Boolean(replyMenuAnchor)}
        onClose={closeReplyMenu}
        className={styles.actionMenu}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: "right",
        }}
      >
        <MenuItem
          onClick={() => {
            if (menuReplyId.length > 0) {
              const [commentId, replyId] = menuReplyId as [string, string];
              deleteReply(commentId, replyId);
            }
            closeReplyMenu();
          }}
        >
          Delete Comments
        </MenuItem>
      </Menu>
    </>
  );
}
