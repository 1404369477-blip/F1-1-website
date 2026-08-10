import { StoryDetailExperience } from "../../../features/stories/story-detail-experience";

export default async function StoryDetailPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <StoryDetailExperience publicId={publicId} />;
}
