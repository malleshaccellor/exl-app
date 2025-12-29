import { Range } from "slate";

export type Reply = {
  id: string;
  text: string;
  createdAt?: number;
};

export type Comment = {
  id: string;
  text: string;
  range: Range;
  createdAt?: number;
  replies: Reply[];
};
