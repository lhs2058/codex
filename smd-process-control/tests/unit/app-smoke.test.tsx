import { render, screen } from "@testing-library/react";
import { App } from "../../src/app/App";

it("renders the SMD application shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "SMD CONTROL" })).toBeInTheDocument();
});
