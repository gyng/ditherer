import configureMockStore from "redux-mock-store";
import thunk from "redux-thunk";
import { getType } from "typesafe-actions";
import * as actions from "../counter";

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

    it("should create an action to increment async", async done => {
      const store = mockStore({});
      const action = actions.incrementAsync(2, 0);
      const expectedActions = [
        {
          meta: undefined,
          payload: {
            value: 2
          },
          type: getType(actions.increment)
        }
      ];

      // mock store typing does not quite support redux-thunk
      // @ts-ignore
      await store.dispatch(action);

      window.setTimeout(() => {
        const dispatched = store.getActions();
        expect(dispatched).toHaveLength(1);
        expect(dispatched).toEqual(expectedActions);
        done();
      });
    });
  });
});
