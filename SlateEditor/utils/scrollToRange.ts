import { Range, Transforms } from "slate";
import { ReactEditor } from "slate-react";

export const scrollToRange = (editor: ReactEditor, range: Range) => {
  if (!range) return;

  Transforms.select(editor, range);
  ReactEditor.focus(editor);

  const domRange = ReactEditor.toDOMRange(editor, range);
  const rect = domRange.getBoundingClientRect();

  window.scrollTo({
    top: window.scrollY + rect.top - 120,
    behavior: "smooth",
  });
};

export default scrollToRange;
