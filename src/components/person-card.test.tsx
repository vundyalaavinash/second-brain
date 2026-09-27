// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PersonCard } from "./person-card";
import type { PersonDTO } from "@/lib/dto";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

function person(over: Partial<PersonDTO> = {}): PersonDTO {
  return {
    id: 1,
    name: "Grace Hopper",
    slug: "grace-hopper",
    profile: "",
    itemCount: 3,
    lastContact: "2026-09-27T09:00:00.000Z",
    meetingCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-27T09:00:00.000Z",
    ...over,
  };
}

afterEach(cleanup);

describe("PersonCard", () => {
  it("leads with recency and how often they meet, both leading to the person", () => {
    render(<PersonCard person={person()} now={NOW} />);
    const link = screen.getByRole("link", { name: /Grace Hopper/ });
    expect(link.getAttribute("href")).toBe("/people/grace-hopper");
    expect(screen.getByText("@grace-hopper")).toBeTruthy();
    expect(screen.getByText("Last contact 3 h ago")).toBeTruthy();
    expect(screen.getByText("2 meetings together")).toBeTruthy();
    expect(screen.getByText("3 items")).toBeTruthy();
  });

  it("says nothing has been linked, rather than a blank recency line", () => {
    render(<PersonCard person={person({ lastContact: null })} now={NOW} />);
    expect(screen.getByText("Nothing linked yet")).toBeTruthy();
  });

  it("drops the meeting line entirely rather than naming a zero", () => {
    render(<PersonCard person={person({ meetingCount: 0 })} now={NOW} />);
    expect(screen.queryByText(/together/)).toBeNull();
  });
});
