import reducer from 'reducers/counters';
import { increment, decrement } from 'actions';

describe('counter reducer', () => {
  it('should return the initial state', () => {
    expect(reducer(undefined, {})).to.eql({ value: 0 });
  });

  it('should handle INCREMENT', () => {
    expect(reducer({ value: 0 }, increment())).to.eql({ value: 1 });
  });

  it('should handle DECREMENT', () => {
    expect(reducer({ value: 0 }, decrement())).to.eql({ value: -1 });
  });
});
