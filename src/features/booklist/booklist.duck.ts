import {
  createReducer,
  createAsyncThunk,
  createAction,
} from "@reduxjs/toolkit";
import { Book } from "@src/domains/books.duck";

const mockBookApi = (_url: string): Promise<{ status: number; data: Book[] }> =>
  new Promise((resolve, reject) => {
    const makeBook = (): Book => ({
      bookId: `${Math.floor(Math.random() * 1000)}`,
      title: Math.random().toString(36).substring(7),
    });
    const fakebooks = [];
    const times = Math.ceil(Math.random() * 9) + 1;
    for (let i = 0; i < times; i++) {
      fakebooks.push(makeBook());
    }

    if (Math.random() < 0.1) {
      reject("Mock failure");
    }

    resolve({
      status: 200,
      data: fakebooks,
    });
  });

const actions = {
  setCurrentBooks: createAction<string[]>("booklist/setCurrent"),
  fetch: createAsyncThunk("booklist/fetch", async (url: string) => {
    // const response = await fetch(url);
    // const books = await response.json();

    const response = await mockBookApi(url);
    const books = response.data;

    const status = await response.status;
    if (status < 400) {
      return books;
    } else {
      throw status;
    }
  }),
};

export interface BooklistState {
  loading: boolean;
  error?: string;
  currentBooks: string[];
}

const reducer = createReducer<BooklistState>(
  { currentBooks: [], loading: false },
  (builder) =>
    builder
      .addCase(actions.fetch.fulfilled, (state, action) => {
        return {
          ...state,
          error: undefined,
          loading: false,
          currentBooks: action.payload.map((b) => b.bookId),
        };
      })
      .addCase(actions.fetch.rejected, (state, action) => {
        return {
          ...state,
          currentBooks: [],
          error: action.error.message,
          loading: false,
        };
      })
      .addCase(actions.fetch.pending, (state, _action) => {
        return { ...state, error: undefined, loading: true };
      })
);

const selectors = {};

export const booklistDuck = {
  actions,
  reducer,
  selectors,
};
