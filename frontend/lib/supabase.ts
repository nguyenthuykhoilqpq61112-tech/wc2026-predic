import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key);

export type FeedbackRow = {
  name?: string;
  rating: number;
  message: string;
  page?: string;
};

export async function submitFeedback(data: FeedbackRow) {
  const { error } = await supabase.from("feedback").insert([data]);
  if (error) throw error;
}
