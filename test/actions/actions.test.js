import * as actions from 'actions';

describe('actions', () => {
  it('should create an action to increment the counter', () => {
    const action = actions.increment();
    expect(action.value).to.equal(1);
  });

  it('should create an action with a custom increment value', () => {
    const action = actions.increment(2);
    expect(action.value).to.equal(2);
  });

  it('should create an action to decrement the counter', () => {
    const action = actions.decrement();
    expect(action.value).to.equal(1);
  });

  it('should create an action with a custom decrement value', () => {
    const action = actions.decrement(2);
    expect(action.value).to.equal(2);
  });
});
