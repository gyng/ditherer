import { connect } from "react-redux";
import { RootDispatch, RootState } from "@src/types";
import { Booklist } from "./Booklist";
import { booklistDuck } from "./booklist.duck";
import { booksAdapter, Book, booksSlice } from "@src/domains/books.duck";

const mapStateToProps = (state: RootState) => ({
  error: state.features.booklist.error,
  // Direct access is acceptable for this, but selectors are recommended for type-safety
  // value: state.features.counters.value,
  loading: state.features.booklist.loading,
  books: state.features.booklist.currentBooks
    .map((id) =>
      booksAdapter.getSelectors().selectById(state.domains.books, id)
    )
    .filter(Boolean) as Book[],
});

const mapDispatchToProps = (dispatch: RootDispatch) => ({
  handleFetchBooks: async (url: string) => {
    const res = await dispatch(booklistDuck.actions.fetch(url));

    if (booklistDuck.actions.fetch.fulfilled.match(res)) {
      dispatch(booksSlice.actions.booksReceived(res.payload));
      dispatch(
        booklistDuck.actions.setCurrentBooks(
          res.payload.map((book) => book.bookId)
        )
      );
    } else if (res.payload) {
      console.log("application error" + JSON.stringify(res));
    } else {
      console.log("network error " + res.error.message);
    }
  },
});

export const BooklistContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Booklist);
