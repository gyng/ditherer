// This theme is passed down via React's context through emotion-theming's
// <ThemeProvider in the <App> component.

import { css } from "emotion";

export default {
  someCssStyle: css`
    color: var(--teal-40);
    padding: var(--m-l);
    align-self: center;
    transition: border-radius 0.3s ease-in;

    .sub {
      font-style: italic;
    }

    &:hover {
      border-radius: var(--curve);

      .sub {
        color: red;
        text-decoration: underline;
      }
    }
  `,
  someThemeStyle: {
    borderRadius: "50%",
    unused: "red"
  }
};
