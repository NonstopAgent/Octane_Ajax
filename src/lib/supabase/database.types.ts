export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      ajax_agents: {
        Row: {
          id: string;
          name: string;
          slug: string;
          role: string;
          status: string;
          current_room: string | null;
          current_task_id: string | null;
          autonomy_level: number;
          last_heartbeat: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          role: string;
          status?: string;
          current_room?: string | null;
          current_task_id?: string | null;
          autonomy_level?: number;
          last_heartbeat?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          role?: string;
          status?: string;
          current_room?: string | null;
          current_task_id?: string | null;
          autonomy_level?: number;
          last_heartbeat?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ajax_agents_current_task_id_fkey";
            columns: ["current_task_id"];
            isOneToOne: false;
            referencedRelation: "ajax_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      ajax_tasks: {
        Row: {
          id: string;
          user_id: string;
          agent_slug: string;
          task_type: string;
          status: string;
          priority: number;
          input: Json;
          output: Json;
          error: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          agent_slug: string;
          task_type: string;
          status?: string;
          priority?: number;
          input?: Json;
          output?: Json;
          error?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          agent_slug?: string;
          task_type?: string;
          status?: string;
          priority?: number;
          input?: Json;
          output?: Json;
          error?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ajax_tasks_agent_slug_fkey";
            columns: ["agent_slug"];
            isOneToOne: false;
            referencedRelation: "ajax_agents";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "ajax_tasks_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      product_ideas: {
        Row: {
          id: string;
          user_id: string;
          source: string;
          niche: string | null;
          title: string | null;
          description: string | null;
          seo_keywords: string[];
          trend_score: number;
          status: string;
          raw_payload: Json;
          brain_score: Json;
          brain_validation: Json;
          brain_verdict: string | null;
          brain_evaluated_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          source?: string;
          niche?: string | null;
          title?: string | null;
          description?: string | null;
          seo_keywords?: string[];
          trend_score?: number;
          status?: string;
          raw_payload?: Json;
          brain_score?: Json;
          brain_validation?: Json;
          brain_verdict?: string | null;
          brain_evaluated_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source?: string;
          niche?: string | null;
          title?: string | null;
          description?: string | null;
          seo_keywords?: string[];
          trend_score?: number;
          status?: string;
          raw_payload?: Json;
          brain_score?: Json;
          brain_validation?: Json;
          brain_verdict?: string | null;
          brain_evaluated_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_ideas_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      product_generations: {
        Row: {
          id: string;
          user_id: string;
          product_idea_id: string;
          product_listing_id: string | null;
          structure: Json;
          llm_provider: string | null;
          llm_model: string | null;
          prompt_version: string | null;
          token_estimate_input: number | null;
          token_estimate_output: number | null;
          generation_status: string;
          pdf_storage_path: string | null;
          pdf_public_url: string | null;
          mockup_storage_path: string | null;
          compliance_flags: Json;
          compliance_warnings: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          product_idea_id: string;
          product_listing_id?: string | null;
          structure?: Json;
          llm_provider?: string | null;
          llm_model?: string | null;
          prompt_version?: string | null;
          token_estimate_input?: number | null;
          token_estimate_output?: number | null;
          generation_status?: string;
          pdf_storage_path?: string | null;
          pdf_public_url?: string | null;
          mockup_storage_path?: string | null;
          compliance_flags?: Json;
          compliance_warnings?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_idea_id?: string;
          product_listing_id?: string | null;
          structure?: Json;
          llm_provider?: string | null;
          llm_model?: string | null;
          prompt_version?: string | null;
          token_estimate_input?: number | null;
          token_estimate_output?: number | null;
          generation_status?: string;
          pdf_storage_path?: string | null;
          pdf_public_url?: string | null;
          mockup_storage_path?: string | null;
          compliance_flags?: Json;
          compliance_warnings?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_generations_product_idea_id_fkey";
            columns: ["product_idea_id"];
            isOneToOne: false;
            referencedRelation: "product_ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_generations_product_listing_id_fkey";
            columns: ["product_listing_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_generations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      product_listings: {
        Row: {
          id: string;
          user_id: string;
          product_idea_id: string;
          title: string | null;
          description: string | null;
          price: number | null;
          mockup_url: string | null;
          platform: string;
          external_listing_id: string | null;
          gumroad_url: string | null;
          gumroad_product_id: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          product_idea_id: string;
          title?: string | null;
          description?: string | null;
          price?: number | null;
          mockup_url?: string | null;
          platform?: string;
          external_listing_id?: string | null;
          gumroad_url?: string | null;
          gumroad_product_id?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_idea_id?: string;
          title?: string | null;
          description?: string | null;
          price?: number | null;
          mockup_url?: string | null;
          platform?: string;
          external_listing_id?: string | null;
          gumroad_url?: string | null;
          gumroad_product_id?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_listings_product_idea_id_fkey";
            columns: ["product_idea_id"];
            isOneToOne: false;
            referencedRelation: "product_ideas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_listings_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      review_queue: {
        Row: {
          id: string;
          user_id: string;
          listing_id: string;
          status: string;
          reviewer_notes: string | null;
          rejection_reason: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          listing_id: string;
          status?: string;
          reviewer_notes?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          listing_id?: string;
          status?: string;
          reviewer_notes?: string | null;
          rejection_reason?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_queue_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: true;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_queue_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_feedback: {
        Row: {
          id: string;
          user_id: string;
          agent_slug: string;
          related_listing_id: string | null;
          feedback_type: string;
          feedback_text: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          agent_slug: string;
          related_listing_id?: string | null;
          feedback_type: string;
          feedback_text: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          agent_slug?: string;
          related_listing_id?: string | null;
          feedback_type?: string;
          feedback_text?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_feedback_agent_slug_fkey";
            columns: ["agent_slug"];
            isOneToOne: false;
            referencedRelation: "ajax_agents";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "agent_feedback_related_listing_id_fkey";
            columns: ["related_listing_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "agent_feedback_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      factory_events: {
        Row: {
          id: string;
          user_id: string;
          event_type: string;
          agent_slug: string | null;
          room: string | null;
          message: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          event_type: string;
          agent_slug?: string | null;
          room?: string | null;
          message: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          event_type?: string;
          agent_slug?: string | null;
          room?: string | null;
          message?: string;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "factory_events_agent_slug_fkey";
            columns: ["agent_slug"];
            isOneToOne: false;
            referencedRelation: "ajax_agents";
            referencedColumns: ["slug"];
          },
          {
            foreignKeyName: "factory_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      etsy_credentials: {
        Row: {
          id: string;
          user_id: string;
          access_token: string;
          refresh_token: string;
          shop_id: string;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          access_token: string;
          refresh_token: string;
          shop_id: string;
          expires_at: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          access_token?: string;
          refresh_token?: string;
          shop_id?: string;
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "etsy_credentials_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      content_jobs: {
        Row: {
          id: string;
          user_id: string;
          listing_id: string;
          platform: string;
          content_type: string;
          status: string;
          asset_url: string | null;
          caption: string | null;
          scheduled_for: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          listing_id: string;
          platform?: string;
          content_type?: string;
          status?: string;
          asset_url?: string | null;
          caption?: string | null;
          scheduled_for?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          listing_id?: string;
          platform?: string;
          content_type?: string;
          status?: string;
          asset_url?: string | null;
          caption?: string | null;
          scheduled_for?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_jobs_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "content_jobs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      order_queue: {
        Row: {
          id: string;
          user_id: string;
          etsy_order_id: string;
          listing_id: string | null;
          customer_photo_url: string;
          style_prompt: string;
          status: string;
          printify_product_id: string | null;
          printify_upload_id: string | null;
          artwork_url: string | null;
          error_message: string | null;
          metadata: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          etsy_order_id: string;
          listing_id?: string | null;
          customer_photo_url: string;
          style_prompt: string;
          status?: string;
          printify_product_id?: string | null;
          printify_upload_id?: string | null;
          artwork_url?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          etsy_order_id?: string;
          listing_id?: string | null;
          customer_photo_url?: string;
          style_prompt?: string;
          status?: string;
          printify_product_id?: string | null;
          printify_upload_id?: string | null;
          artwork_url?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_queue_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "product_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_queue_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      etsy_oauth_sessions: {
        Row: {
          state: string;
          user_id: string;
          code_verifier: string;
          created_at: string;
        };
        Insert: {
          state: string;
          user_id: string;
          code_verifier: string;
          created_at?: string;
        };
        Update: {
          state?: string;
          user_id?: string;
          code_verifier?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      listing_performance_snapshots: {
        Row: {
          id: string;
          user_id: string;
          etsy_listing_id: string;
          listing_id: string | null;
          title: string | null;
          views: number;
          favorites: number;
          revenue_cents: number;
          orders: number;
          snapshot_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          etsy_listing_id: string;
          listing_id?: string | null;
          title?: string | null;
          views?: number;
          favorites?: number;
          revenue_cents?: number;
          orders?: number;
          snapshot_date?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          etsy_listing_id?: string;
          listing_id?: string | null;
          title?: string | null;
          views?: number;
          favorites?: number;
          revenue_cents?: number;
          orders?: number;
          snapshot_date?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      llm_usage_log: {
        Row: {
          id: string;
          user_id: string | null;
          task: string | null;
          provider: string;
          model: string;
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
          cost_usd: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          task?: string | null;
          provider?: string;
          model: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          cost_usd?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          task?: string | null;
          provider?: string;
          model?: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          cost_usd?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      market_keywords: {
        Row: {
          id: string;
          user_id: string;
          term: string;
          searches_per_month: number | null;
          competing_listings: number | null;
          source: string;
          notes: string | null;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          term: string;
          searches_per_month?: number | null;
          competing_listings?: number | null;
          source?: string;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          term?: string;
          searches_per_month?: number | null;
          competing_listings?: number | null;
          source?: string;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      strategy_recommendations: {
        Row: {
          id: string;
          user_id: string;
          run_id: string;
          category: string;
          title: string;
          rationale: string;
          recommended_action: string;
          priority: number;
          confidence: number | null;
          evidence: Json;
          status: string;
          drafted_idea_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          run_id: string;
          category: string;
          title: string;
          rationale?: string;
          recommended_action?: string;
          priority?: number;
          confidence?: number | null;
          evidence?: Json;
          status?: string;
          drafted_idea_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          run_id?: string;
          category?: string;
          title?: string;
          rationale?: string;
          recommended_action?: string;
          priority?: number;
          confidence?: number | null;
          evidence?: Json;
          status?: string;
          drafted_idea_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tiktok_queue: {
        Row: {
          id: string;
          user_id: string;
          product_generation_id: string;
          status: string;
          caption: string;
          hashtags: string[];
          mockup_urls: string[];
          slideshow_script: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          product_generation_id: string;
          status?: string;
          caption: string;
          hashtags?: string[];
          mockup_urls?: string[];
          slideshow_script?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          product_generation_id?: string;
          status?: string;
          caption?: string;
          hashtags?: string[];
          mockup_urls?: string[];
          slideshow_script?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tiktok_queue_product_generation_id_fkey";
            columns: ["product_generation_id"];
            isOneToOne: false;
            referencedRelation: "product_generations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tiktok_queue_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type AjaxAgent = Tables<"ajax_agents">;
export type AjaxTask = Tables<"ajax_tasks">;
export type ProductIdea = Tables<"product_ideas">;
export type ProductGeneration = Tables<"product_generations">;
export type ProductListing = Tables<"product_listings">;
export type ReviewQueueItem = Tables<"review_queue">;
export type AgentFeedback = Tables<"agent_feedback">;
export type FactoryEvent = Tables<"factory_events">;
export type ContentJob = Tables<"content_jobs">;
export type OrderQueue = Tables<"order_queue">;
export type TikTokQueue = Tables<"tiktok_queue">;
