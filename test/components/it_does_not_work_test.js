import React from 'react';
import { shallow } from 'enzyme';
import App from '../../src/components/App';

describe('I hate my life', () => {
  it('is a horrible tooling ecosystem', () => {
    const wrapper = shallow(<App />);
    expect(wrapper.find('p')).to.have.length(1);
  });
});
