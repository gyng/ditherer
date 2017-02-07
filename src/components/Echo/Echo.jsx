/* @flow */

import React from 'react';

import s from './styles.scss';

const Echo = (props: { text: boolean }) => <p className={s.text}>{props.text}</p>;

export default Echo;
