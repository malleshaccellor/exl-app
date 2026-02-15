import type { BaseEditor } from "slate";
import { ReactEditor } from "slate-react";
import { HistoryEditor } from "slate-history";

export type AlignType = "left" | "center" | "right";
export type textStyle = "bold" | "italic" | "underline" | "strikethrough";
export type textListStyle = "bulleted-list" | "numbered-list";

export type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  underline?: boolean;
  code?: boolean;
  fontFamily?: string;
  fontSize?: string;
  commentId?: string;
  indent?: number;
};

type HeadingOneElement = {
  type: "heading-one";
  align?: AlignType;
  indent?: number;
  fontSize?: string;
  children: CustomText[];
};

type HeadingTwoElement = {
  type: "heading-two";
  align?: AlignType;
  indent?: number;
  fontSize?: string;
  children: CustomText[];
};

type HeadingThreeElement = {
  type: "heading-three";
  align?: AlignType;
  indent?: number;
  fontSize?: string;
  children: CustomText[];
};

type HeadingFourElement = {
  type: "heading-four";
  align?: AlignType;
  indent?: number;
  fontSize?: string;
  children: CustomText[];
};

type HeadingFiveElement = {
  type: "heading-five";
  align?: AlignType;
  indent?: number;
  fontSize?: string;
  children: CustomText[];
};

type HeadingSixElement = {
  type: "heading-six";
  align?: AlignType;
  indent?: number;
  fontSize?: string;
  children: CustomText[];
};

type ParagraphElement = {
  type: "paragraph";
  indent?: number;
  align?: AlignType;
  fontSize?: string;
  children: CustomText[];
};

type ListItemElement = {
  type: "list-item";
  indent?: number;
  align?: AlignType;
  fontSize?: string;
  children: CustomText[];
};

type BulletedListElement = {
  type: "bulleted-list";
  indent?: number;
  align?: AlignType;
  fontSize?: string;
  children: ListItemElement[];
};

type NumberedListElement = {
  type: "numbered-list";
  indent?: number;
  align?: AlignType;
  fontSize?: string;
  children: ListItemElement[];
};

type BlockQuoteElement = {
  type: "block-quote";
  indent?: number;
  align?: AlignType;
  fontSize?: string;
  children: CustomText[];
};

type CodeBlockElement = {
  type: "code-block";
  indent?: number;
  align?: AlignType;
  fontSize?: string;
  children: CustomText[];
};

type TableCellElement = {
  type: "table-cell";
  isHeader?: boolean;
  children: (ParagraphElement | CustomText)[];
};

type TableCellHeaderElement = {
  type: "table-cell-header";
  children: (ParagraphElement | CustomText)[];
};

type TableRowElement = {
  type: "table-row";
  hiddenData?: Record<string, string>;
  children: (TableCellElement | TableCellHeaderElement)[];
};

type TableElement = {
  type: "table";
  className?: string;
  children: TableRowElement[];
};

export type CustomElement =
  | ParagraphElement
  | ListItemElement
  | BulletedListElement
  | NumberedListElement
  | HeadingOneElement
  | HeadingTwoElement
  | HeadingThreeElement
  | HeadingFourElement
  | HeadingFiveElement
  | HeadingSixElement
  | BlockQuoteElement
  | CodeBlockElement
  | TableElement
  | TableRowElement
  | TableCellElement
  | TableCellHeaderElement;

declare module "slate" {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}
