import React from 'react';
import { shallow } from 'enzyme';
import Counter from 'components/Counter';

describe('Counter', () => {
  let render;

  before(() => {
    render = shallow(<Counter value={0} onIncrementClick={() => {}} />);
  });

  it('renders the value', () => {
    const valueEl = render.find('div .value');
    expect(valueEl.text()).to.equal('0');
  });

  it('renders the increment button', () => {
    const incrementEl = render.find('button .increment');
    expect(incrementEl).to.have.length(1);
  });
});
