import type { Metadata } from "next";

import { FeedExperience } from "../../../src/features/stories/feed-experience";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "https://f1plus1.com" }
};

export default function PublicStaticHomePage() {
  return <FeedExperience />;
}
