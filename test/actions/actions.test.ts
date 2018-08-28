import * as actions from "@src/actions";
import configureMockStore from "redux-mock-store";
import thunk from "redux-thunk";
import { getType } from "typesafe-actions";

const middlewares = [thunk];
const mockStore = configureMockStore(middlewares);

describe("actions", () => {
  it("should create an action to increment the counter", () => {
    const action = actions.increment();
    expect(action.payload.value).toEqual(1);
  });

  it("should create an action with a custom increment value", () => {
    const action = actions.increment(2);
    expect(action.payload.value).toEqual(2);
  });

  it("should create an action to decrement the counter", () => {
    const action = actions.decrement();
    expect(action.payload.value).toEqual(1);
  });

  it("should create an action with a custom decrement value", () => {
    const action = actions.decrement(2);
    expect(action.payload.value).toEqual(2);
  });

  describe("async", () => {
    let timeout: typeof window.setTimeout;

    beforeEach(() => {
      timeout = window.setTimeout;
      window.setTimeout = (f: any) => f();
    });

    afterEach(() => {
      window.setTimeout = timeout;
    });

    it("should create an action to increment async", () => {
      const store = mockStore({});
      const action = actions.incrementAsync(2, 0);
      const expectedActions = [{ type: getType(actions.increment), value: 2 }];

      Promise.resolve(store.dispatch(action)).then(() => {
        const dispatched = store.getActions();
        expect(dispatched).to.have.length(1);
        expect(dispatched).to.deep.equal(expectedActions);
      });
    });
  });
});
