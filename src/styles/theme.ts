// This theme is passed down via React's context through emotion-theming's
// <ThemeProvider in the <App> component.

import { css } from "emotion";

export default {
  someCssStyle: css`
    color: #dd4444;
  `,
  someThemeStyle: {
    borderRadius: "50%",
    unused: "red"
  }
};
