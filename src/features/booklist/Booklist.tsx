import React from "react";
import { Book } from "@src/domains/books.duck";

export interface BooklistProps {
  books: Book[];
  loading: boolean;
  error?: string;
  handleFetchBooks: (url: any) => any;
}

export const Booklist: React.SFC<BooklistProps> = (props) => {
  return (
    <div>
      {props.loading ? (
        "Loading"
      ) : (
        <button
          onClick={() => {
            props.handleFetchBooks("");
          }}
        >
          Fetch books
        </button>
      )}

      <hr />

      <pre>
        {props.error}
        {JSON.stringify(props.books, null, 2)}
      </pre>
    </div>
  );
};
