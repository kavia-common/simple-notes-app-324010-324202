import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders notes header", () => {
  render(<App />);
  const title = screen.getByText(/notes/i);
  expect(title).toBeInTheDocument();
});
