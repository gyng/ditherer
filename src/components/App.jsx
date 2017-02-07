import React from 'react';

import Echo from './Echo';

/* eslint-disable react/prefer-stateless-function */
export default class App extends React.Component {
  render() {
    return (
      <div>
        <Echo text="Hello, world!" />
        <Echo text="Find me in App.jsx!" />
      </div>
    );
  }
}
/* eslint-enable react/prefer-stateless-function */
