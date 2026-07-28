import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "../../src/app/App";

it("holds protected routes behind session restoration", () => {
  render(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.getByRole("status")).toHaveTextContent("Loading session…");
});
