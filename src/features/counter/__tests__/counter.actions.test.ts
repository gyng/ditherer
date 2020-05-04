import { actions } from "../counter.duck";
import configureMockStore from "redux-mock-store";
import thunk from "redux-thunk";

describe("actions", () => {
  let mockStore: any;

  beforeEach(() => {
    const middlewares = [thunk];
    mockStore = configureMockStore(middlewares);
  });

  it("should create an action to increment the counter", () => {
    const action = actions.increment(1);
    expect(action.payload).toEqual(1);
  });

  it("should create an action with a custom increment value", () => {
    const action = actions.increment(2);
    expect(action.payload).toEqual(2);
  });

  it("should create an action to decrement the counter", () => {
    const action = actions.decrement();
    expect(action.payload).toEqual({ value: 1 });
  });

  it("should create an action with a custom decrement value", () => {
    const action = actions.decrement(2);
    expect(action.payload).toEqual({ value: 2 });
  });

  // For async testing, there are a few strategies you can take
  describe("async", () => {
    // let timeout: typeof window.setTimeout;

    // beforeEach(() => {
    //   timeout = window.setTimeout;
    //   const immediate = (f: any) => f();
    //   immediate.__promisify__ = jest.fn();
    //   window.setTimeout = immediate;
    // });

    // afterEach(() => {
    //   window.setTimeout = timeout;
    // });

    it("should test an async promise", async () => {
      const testObject = { foo: "bar" };
      const response = new Response(JSON.stringify(testObject), {
        status: 200,
      });
      // Run the async promise
      const json = await response.json();
      expect(json).toStrictEqual(testObject);
    });

    it("should test an async promise with jest's convenience syntax", async () => {
      const response = new Response("{invalid-json}", {
        status: 500,
      });
      return expect(response.json()).rejects.toThrow("invalid json");
      // or, `return expect(response.json()).resolves.toBe(testObject);
    });

    it("should create an action to increment async with a global timer", async () => {
      const store = mockStore({});
      const action = actions.incrementAsync(2, 0);
      const expectedActions = [
        {
          meta: undefined,
          payload: 2,
          type: actions.increment.type,
        },
      ];

      jest.useFakeTimers();
      await store.dispatch(action);
      jest.runAllTimers();

      const dispatched = store.getActions();
      expect(dispatched).toHaveLength(1);
      expect(dispatched).toEqual(expectedActions);
    });
  });
});
