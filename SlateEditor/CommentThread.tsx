import React, { useState } from "react";
import type { Comment } from "./types/types";

type Props = {
  comment: Comment;
  onClick: () => void;
  onUpdate: React.Dispatch<React.SetStateAction<Comment[]>>;
};

export default function CommentThread({ comment, onClick, onUpdate }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.text);
  const [reply, setReply] = useState("");

  return (
    <div style={{ marginBottom: 12 }}>
      <div onClick={onClick} style={{ cursor: "pointer" }}>
        {editing ? (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} />
            <button
              onClick={() => {
                onUpdate((prev) =>
                  prev.map((c) => (c.id === comment.id ? { ...c, text } : c))
                );
                setEditing(false);
              }}
            >
              Save
            </button>
          </>
        ) : (
          <>
            <strong>{comment.text}</strong>
            <button onClick={() => setEditing(true)}>Edit</button>
            <button
              onClick={() =>
                onUpdate((prev) => prev.filter((c) => c.id !== comment.id))
              }
            >
              Delete
            </button>
          </>
        )}
      </div>

      {comment.replies.map((r) => (
        <div key={r.id} style={{ marginLeft: 10 }}>
          🗨 {r.text}
        </div>
      ))}

      <input
        value={reply}
        placeholder="Reply..."
        onChange={(e) => setReply(e.target.value)}
      />
      <button
        onClick={() => {
          if (!reply) return;
          onUpdate((prev) =>
            prev.map((c) =>
              c.id === comment.id
                ? {
                    ...c,
                    replies: [
                      ...c.replies,
                      { id: Date.now().toString(), text: reply },
                    ],
                  }
                : c
            )
          );
          setReply("");
        }}
      >
        Reply
      </button>
    </div>
  );
}
