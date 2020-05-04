import { createEntityAdapter, createSlice } from "@reduxjs/toolkit";

// This example is adapted from
// https://redux-toolkit.js.org/api/createEntityAdapter

export interface Book {
  bookId: string;
  title: string;
}

export const booksAdapter = createEntityAdapter<Book>({
  // Assume IDs are stored in a field other than `book.id`
  // defaults to `.id` if not given
  selectId: (book) => book.bookId,
  // Keep the "all IDs" array sorted based on book titles
  sortComparer: (a, b) => a.title.localeCompare(b.title),
});

export const booksSlice = createSlice({
  name: "books",
  initialState: booksAdapter.getInitialState({}),
  reducers: {
    // Can pass adapter functions directly as case reducers.  Because we're passing this
    // as a value, `createSlice` will auto-generate the `bookAdded` action type / creator
    bookAdded: booksAdapter.addOne,
    booksReceived(state, action) {
      booksAdapter.setAll(state, action.payload);
    },
    bookUpdated: booksAdapter.updateOne,
  },
});

export const books = {
  adapter: booksAdapter,
  actions: booksSlice.actions,
  reducer: booksSlice.reducer,
  selectors: booksAdapter.getSelectors(),
};
