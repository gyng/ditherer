import React from 'react';
import { shallow } from 'enzyme';
import App from '../../src/components/App';
import Echo from '../../src/components/Echo';

describe('self torture', () => {
  it('is a horrible tooling ecosystem', () => {
    const wrapper = shallow(<App />);
    const echoes = wrapper.find(Echo);
    expect(echoes).to.have.length(2);
    expect(echoes.find({ text: 'Hello, world!' })).to.have.length(1);
    expect(echoes.find({ text: 'Find me in App.jsx!' })).to.have.length(1);
  });
});
