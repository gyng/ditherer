import React from 'react';

const Echo = ({ text }) => <p>{text}</p>;

Echo.propTypes = {
  text: React.PropTypes.string.isRequired,
};

export default Echo;
