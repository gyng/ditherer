// This theme is passed down via React's context through emotion-theming's
// <ThemeProvider in the <App> component.

import { css } from "emotion";

export default {
  someCssStyle: css`
    color: var(--teal-50);
    padding: var(--m-m);
    transition: border-radius 0.3s ease-in;

    &:hover {
      border-radius: var(--curve);

      .sub {
        color: red;
        font-style: underline !important;
      }
    }

    .sub {
      font-style: italic;
    }
  `,
  someThemeStyle: {
    borderRadius: "50%",
    unused: "red"
  }
};
