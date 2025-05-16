import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User schema
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name").notNull(),
  avatar: text("avatar"),
  description: text("description"),
  subscribers: integer("subscribers").default(0),
  latitude: text("latitude"),
  longitude: text("longitude"),
  lastLocationUpdate: timestamp("last_location_update"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Category schema
export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
});

// Video schema with ad revenue
export const videos = pgTable("videos", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  categoryId: integer("category_id").references(() => categories.id),
  title: text("title").notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  videoUrl: text("video_url").notNull(),
  views: integer("views").default(0),
  likes: integer("likes").default(0),
  dislikes: integer("dislikes").default(0),
  adRevenue: integer("ad_revenue").default(0),
  adImpressions: integer("ad_impressions").default(0),
  duration: integer("duration"),
  isArchived: boolean("is_archived").default(false),
  isDeleted: boolean("is_deleted").default(false),
  isPromoted: boolean("is_promoted").default(false),
  promotionPending: boolean("promotion_pending").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// Comment schema
export const comments = pgTable("comments", {
  id: serial("id").primaryKey(),
  videoId: integer("video_id").references(() => videos.id),
  userId: integer("user_id").references(() => users.id),
  content: text("content").notNull(),
  likes: integer("likes").default(0),
  dislikes: integer("dislikes").default(0),
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Subscription schema
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  subscriberId: integer("subscriber_id").references(() => users.id),
  publisherId: integer("publisher_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

// Ad Network schemas
export const advertisements = pgTable("advertisements", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  content: text("content").notNull(),
  targetUrl: text("target_url"),
  budget: integer("budget").notNull(),
  cpm: integer("cpm").notNull(),
  adRate: integer("ad_rate").default(0),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  status: text("status").default("active"),
  targeting: text("targeting"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const adPlacements = pgTable("ad_placements", {
  id: serial("id").primaryKey(),
  adId: integer("ad_id").references(() => advertisements.id),
  videoId: integer("video_id").references(() => videos.id),
  position: text("position").notNull(),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const adStats = pgTable("ad_stats", {
  id: serial("id").primaryKey(),
  adId: integer("ad_id").references(() => advertisements.id),
  date: timestamp("date").defaultNow(),
  impressions: integer("impressions").default(0),
  clicks: integer("clicks").default(0),
  spend: integer("spend").default(0),
  region: text("region"),
  device: text("device"),
});

// Playlist schema
export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  isPrivate: boolean("is_private").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const playlistVideos = pgTable("playlist_videos", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").references(() => playlists.id),
  videoId: integer("video_id").references(() => videos.id),
  position: integer("position").notNull(),
  addedAt: timestamp("added_at").defaultNow(),
});

// Schemas for inserts
export const insertUserSchema = createInsertSchema(users).omit({ id: true, subscribers: true, createdAt: true });
export const insertVideoSchema = createInsertSchema(videos).omit({ id: true, views: true, likes: true, dislikes: true, createdAt: true });
export const insertCommentSchema = createInsertSchema(comments).omit({ id: true, likes: true, dislikes: true, createdAt: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true });
export const insertCategorySchema = createInsertSchema(categories).omit({ id: true });
export const insertPlaylistSchema = createInsertSchema(playlists).omit({ id: true, createdAt: true });
export const insertPlaylistVideoSchema = createInsertSchema(playlistVideos).omit({ id: true, addedAt: true });

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Advertisement = typeof advertisements.$inferSelect;
export type AdPlacement = typeof adPlacements.$inferSelect;
export type AdStat = typeof adStats.$inferSelect;

export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videos.$inferSelect & {
  userLiked?: boolean;
  userDisliked?: boolean;
  userSaved?: boolean;
};

export type InsertComment = z.infer<typeof insertCommentSchema>;
export type Comment = typeof comments.$inferSelect;

export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptions.$inferSelect;

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

export type InsertPlaylist = z.infer<typeof insertPlaylistSchema>;
export type Playlist = typeof playlists.$inferSelect;
export type PlaylistVideo = typeof playlistVideos.$inferSelect;

export const insertFeedbackSchema = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    text: { type: 'string' },
    email: { type: 'string' },
    timestamp: { type: 'string' }
  },
  required: ['type', 'text']
};