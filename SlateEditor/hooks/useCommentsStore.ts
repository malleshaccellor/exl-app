import { useEffect, useState } from "react";
import type { Descendant } from "slate";
import type { Comment } from "../types/types";

const KEY = "slate-editor-state";

export function useSlateStore(initialValue: Descendant[]) {
  const [content, setContent] = useState<Descendant[]>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw).content : initialValue;
    } catch {
      return initialValue;
    }
  });

  const [comments, setComments] = useState<Comment[]>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw).comments : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify({ content, comments }));
  }, [content, comments]);

  return { content, setContent, comments, setComments };
}
