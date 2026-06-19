export type Client = {
  id: string;
  name: string;
  website: string;
  industry: string;
  target_country: string;
  target_language: string;
  description: string | null;
  main_products: string | null;
  competitors: string[];
  compliance_notes: string | null;
  owner_user_id: string | null;
  agency_id: string;
  created_at: string;
  updated_at: string;
};

export type UserRole = 'admin' | 'strategist' | 'client';

export type UserProfile = {
  id: string;
  user_id: string;
  full_name: string | null;
  role: UserRole;
  client_id: string | null;
  created_at: string;
};

export type GeoQuery = {
  id: string;
  client_id: string;
  agency_id: string;
  query_text: string;
  language: string;
  country: string;
  intent_type: 'brand' | 'category' | 'competitor' | 'trust' | 'conversion' | 'comparison';
  funnel_stage: string;
  priority: number;
  created_at: string;
};

export type GeoRun = {
  id: string;
  client_id: string;
  run_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  error_message: string | null;
  share_token: string;
  agency_id: string;
  total_queries: number;
  processed_queries: number;
  created_at: string;
  is_stalled?: boolean;
  can_resume?: boolean;
  last_progress_at?: string | null;
};

export type GeoRunStep = {
  id: string;
  agency_id: string;
  client_id: string;
  run_id: string;
  query_id: string | null;
  step_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  title: string;
  message: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type GeoAnswer = {
  id: string;
  run_id: string;
  client_id: string;
  agency_id: string;
  query_id: string | null;
  model_provider: string;
  model_name: string;
  answer_text: string;
  brand_mentioned: boolean;
  brand_position: number | null;
  competitors_mentioned: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  recommendation_status: 'recommended' | 'mentioned_only' | 'not_mentioned' | 'competitor_recommended';
  citations: unknown[];
  content_gap: string | null;
  risk_notes: unknown[];
  created_at: string;
};

export type GeoInsight = {
  id: string;
  client_id: string;
  run_id: string;
  agency_id: string;
  visibility_score: number;
  mention_rate: number;
  recommendation_rate: number;
  competitor_summary: unknown[];
  sentiment_summary: Record<string, unknown>;
  content_gaps: unknown[];
  action_plan: unknown[];
  risk_notes: unknown[];
  executive_summary: string | null;
  created_at: string;
};

export type ContentTask = {
  id: string;
  client_id: string;
  run_id: string | null;
  agency_id: string;
  title: string;
  content_type: 'faq' | 'comparison_page' | 'blog' | 'landing_page' | 'third_party_review' | 'reddit_quora_answer' | 'ad_creative_angle';
  target_query: string | null;
  priority: number;
  status: 'todo' | 'in_progress' | 'done' | 'skipped';
  assigned_to: string | null;
  brief: string | null;
  created_at: string;
  updated_at: string;
};

export type Agency = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
};

export type AgencyMember = {
  id: string;
  agency_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
};
