import { 
  users, type User, type InsertUser, 
  videos, type Video, type InsertVideo, 
  comments, type Comment, type InsertComment, 
  subscriptions, type Subscription, type InsertSubscription,
  categories, type Category, type InsertCategory 
} from "@shared/schema";

export interface IStorage {
  // Ad Network operations
  getAds(): Promise<Advertisement[]>;
  createAd(ad: Partial<Advertisement>): Promise<Advertisement>;
  getAdStats(): Promise<AdStat[]>;

  // User operations  
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Video operations
  getVideo(id: number, userId?: number): Promise<Video | undefined>;
  getVideos(limit?: number, offset?: number, categoryId?: number): Promise<Video[]>;
  getUserVideos(userId: number): Promise<Video[]>;
  createVideo(video: InsertVideo): Promise<Video>;
  incrementViews(id: number): Promise<void>;
  likeVideo(id: number, userId: number): Promise<Video>;
  dislikeVideo(id: number, userId: number): Promise<Video>;
  searchVideos(query: string, categoryId?: number): Promise<Video[]>;
  saveVideo(id: number, userId: number): Promise<boolean>;
  unsaveVideo(id: number, userId: number): Promise<boolean>;
  getSavedVideos(userId: number): Promise<Video[]>;
  isSaved(videoId: number, userId: number): Promise<boolean>;
  incrementVideoAdImpressions(videoId: number): Promise<void>; // Added function

  // Comment operations
  getVideoComments(videoId: number): Promise<Comment[]>;
  createComment(comment: InsertComment): Promise<Comment>;

  // Subscription operations
  createSubscription(subscription: InsertSubscription): Promise<Subscription>;
  getUserSubscriptions(userId: number): Promise<User[]>;
  isSubscribed(subscriberId: number, publisherId: number): Promise<boolean>;

  // Category operations
  getCategories(): Promise<Category[]>;
  createCategory(category: InsertCategory): Promise<Category>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private videos: Map<number, Video>;
  private comments: Map<number, Comment>;
  private subscriptions: Map<number, Subscription>;
  private categories: Map<number, Category>;

  private userId: number;
  private videoId: number;
  private commentId: number;
  private subscriptionId: number;
  private categoryId: number;

  // Maps to track likes and dislikes by user (videoId_userId)
  private userLikes: Map<string, boolean>;
  private userDislikes: Map<string, boolean>;

  // Map to track saved videos by user (videoId_userId)
  private userSavedVideos: Map<string, boolean>;
  private watchHistory: Map<number, number[]>; // userId -> videoIds[]
  private videoProgress: Map<string, number>; // userId_videoId -> progress in seconds
  
  async saveVideoProgress(userId: number, videoId: number, progress: number): Promise<void> {
    const key = `${userId}_${videoId}`;
    this.videoProgress.set(key, progress);
  }

  async getVideoProgress(userId: number, videoId: number): Promise<number> {
    const key = `${userId}_${videoId}`;
    return this.videoProgress.get(key) || 0;
  }

  async getWatchHistory(userId: number): Promise<Video[]> {
    const history = this.watchHistory.get(userId) || [];
    return history.map(videoId => this.videos.get(videoId))
      .filter((video): video is Video => video !== undefined)
      .reverse(); // Most recent first
  }

  async addToWatchHistory(userId: number, videoId: number): Promise<void> {
    const history = this.watchHistory.get(userId) || [];
    // Remove existing entry to avoid duplicates
    const filtered = history.filter(id => id !== videoId);
    // Add to front of array (most recent)
    filtered.unshift(videoId);
    // Keep only last 100 videos
    this.watchHistory.set(userId, filtered.slice(0, 100));
  }

  private ads: Map<number, Advertisement>;
  private adStats: Map<number, AdStat>;
  private adId: number;
  private adSettings: {
    defaultCpm: number;
    minimumBudget: number;
    revenuePerView: number;
    categories: string[];
  } = {
    defaultCpm: 0,
    minimumBudget: 0,
    revenuePerView: 0,
    categories: []
  };

  constructor() {
    this.users = new Map();
    this.videos = new Map();
    this.comments = new Map();
    this.subscriptions = new Map();
    this.categories = new Map();
    this.ads = new Map();
    this.adStats = new Map();
    this.adId = 1;
    this.userLikes = new Map();
    this.userDislikes = new Map();
    this.userSavedVideos = new Map();
    this.watchHistory = new Map();
    this.videoProgress = new Map();

    this.userId = 1;
    this.videoId = 1;
    this.commentId = 1;
    this.subscriptionId = 1;
    this.categoryId = 1;

    // Initialize with some data
    this.initializeData();
  }

  private initializeData() {
    // Create default categories
    const categoryNames = ["All", "Gaming", "Music", "Tech Reviews", "Cooking", "Tutorials", "Vlogs", "Comedy", "Sports", "Travel"];
    categoryNames.forEach(name => {
      this.createCategory({ name });
    });

    // No pre-created users, videos, or comments - everything will be dynamic
  }

  // User operations
  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userId++;
    const user: User = { 
      ...insertUser, 
      id, 
      subscribers: 0, 
      description: insertUser.description || '', 
      createdAt: new Date() 
    };
    this.users.set(id, user);
    return user;
  }

  // Video operations
  async getVideo(id: number, userId?: number): Promise<Video | undefined> {
    const video = this.videos.get(id);
    if (!video) return undefined;

    // If userId is provided, include user's like/dislike/saved status
    if (userId) {
      const likeKey = `${id}_${userId}`;
      const dislikeKey = `${id}_${userId}`;
      const savedKey = `${id}_${userId}`;

      return {
        ...video,
        userLiked: this.userLikes.get(likeKey) || false,
        userDisliked: this.userDislikes.get(dislikeKey) || false,
        userSaved: this.userSavedVideos.get(savedKey) || false
      };
    }

    return video;
  }

  async getVideos(limit = 20, offset = 0, categoryId?: number, showDeleted = false): Promise<Video[]> {
    return Array.from(this.videos.values())
      .filter(video => !categoryId || categoryId === 1 || video.categoryId === categoryId)
      .filter(video => {
        if (showDeleted) {
          // For trash page, show only deleted but not permanently deleted videos
          return video.isDeleted && !video.permanentlyDeleted;
        }
        // For normal pages, hide deleted and permanently deleted videos
        return !video.isDeleted && !video.permanentlyDeleted;
      })
      .sort((a, b) => b.id - a.id)
      .slice(offset, offset + limit);
  }

  async getUserVideos(userId: number): Promise<Video[]> {
    return Array.from(this.videos.values())
      .filter(video => video.userId === userId)
      .filter(video => !video.permanentlyDeleted && !video.isDeleted)
      .sort((a, b) => b.id - a.id);
  }

  async createVideo(video: InsertVideo): Promise<Video> {
    const id = this.videoId++;
    const newVideo: Video = { 
      ...video, 
      id, 
      views: 0, 
      likes: 0, 
      dislikes: 0, 
      ad_impressions: 0,
      ad_revenue: 0,
      createdAt: new Date()
    };
    this.videos.set(id, newVideo);
    return newVideo;
  }

  async updateVideo(id: number, updates: Partial<Video>): Promise<Video> {
    const video = this.videos.get(id);
    if (!video) {
      throw new Error('Video not found');
    }
    const updatedVideo = { ...video, ...updates };
    this.videos.set(id, updatedVideo);
    return updatedVideo;
  }

  async incrementViews(id: number): Promise<void> {
    const video = this.videos.get(id);
    if (video) {
      video.views += 1;
      this.videos.set(id, video);
    }
  }

  async likeVideo(id: number, userId: number): Promise<Video> {
    const video = this.videos.get(id);
    if (!video) {
      throw new Error('Video not found');
    }

    // Generate keys for tracking
    const likeKey = `${id}_${userId}`;
    const dislikeKey = `${id}_${userId}`;

    // Check if user already liked this video
    if (this.userLikes.get(likeKey)) {
      // User already liked - remove like
      video.likes = Math.max(0, video.likes - 1);
      this.userLikes.delete(likeKey);
    } else {
      // New like - add it
      video.likes += 1;
      this.userLikes.set(likeKey, true);

      // If user previously disliked, remove that dislike
      if (this.userDislikes.get(dislikeKey)) {
        video.dislikes = Math.max(0, video.dislikes - 1);
        this.userDislikes.delete(dislikeKey);
      }
    }

    this.videos.set(id, video);

    // Return updated video with user's like status
    return {
      ...video,
      userLiked: this.userLikes.get(likeKey) || false,
      userDisliked: this.userDislikes.get(dislikeKey) || false
    };
  }

  async dislikeVideo(id: number, userId: number): Promise<Video> {
    const video = this.videos.get(id);
    if (!video) {
      throw new Error('Video not found');
    }

    // Generate keys for tracking
    const likeKey = `${id}_${userId}`;
    const dislikeKey = `${id}_${userId}`;

    // Check if user already disliked this video
    if (this.userDislikes.get(dislikeKey)) {
      // User already disliked - remove dislike
      video.dislikes = Math.max(0, video.dislikes - 1);
      this.userDislikes.delete(dislikeKey);
    } else {
      // New dislike - add it
      video.dislikes += 1;
      this.userDislikes.set(dislikeKey, true);

      // If user previously liked, remove that like
      if (this.userLikes.get(likeKey)) {
        video.likes = Math.max(0, video.likes - 1);
        this.userLikes.delete(likeKey);
      }
    }

    this.videos.set(id, video);

    // Return updated video with user's like status
    return {
      ...video,
      userLiked: this.userLikes.get(likeKey) || false,
      userDisliked: this.userDislikes.get(dislikeKey) || false
    };
  }

  async searchVideos(query: string, categoryId?: number): Promise<Video[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.videos.values())
      .filter(video => 
        (video.title.toLowerCase().includes(lowerQuery) || 
        (video.description && video.description.toLowerCase().includes(lowerQuery))) &&
        (!categoryId || categoryId === 1 || video.categoryId === categoryId)
      );
  }

  // Comment operations
  async getVideoComments(videoId: number): Promise<Comment[]> {
    const comments = Array.from(this.comments.values())
      .filter(comment => comment.videoId === videoId)
      .sort((a, b) => b.id - a.id);

    // Explicitly log all users and comments for debugging
    console.log('All users:', Array.from(this.users.values()).map(u => ({ id: u.id, username: u.username })));
    console.log('Comments being returned:', comments);

    return comments;
  }

  async createComment(comment: InsertComment): Promise<Comment> {
    const id = this.commentId++;
    const newComment: Comment = { 
      ...comment, 
      id, 
      likes: comment.likes || 0, 
      dislikes: comment.dislikes || 0, 
      createdAt: new Date()
    };
    this.comments.set(id, newComment);
    return newComment;
  }

  // Subscription operations
  async createSubscription(subscription: InsertSubscription): Promise<Subscription> {
    const id = this.subscriptionId++;
    const newSubscription: Subscription = { 
      ...subscription, 
      id, 
      createdAt: new Date()
    };

    // Increment subscribers count
    const publisher = this.users.get(subscription.publisherId);
    if (publisher) {
      publisher.subscribers += 1;
      this.users.set(publisher.id, publisher);
    }

    this.subscriptions.set(id, newSubscription);
    return newSubscription;
  }

  async getUserSubscriptions(userId: number): Promise<User[]> {
    const subscriptions = Array.from(this.subscriptions.values())
      .filter(sub => sub.subscriberId === userId);

    return subscriptions.map(sub => {
      const publisher = this.users.get(sub.publisherId);
      return publisher!;
    }).filter(Boolean);
  }

  async isSubscribed(subscriberId: number, publisherId: number): Promise<boolean> {
    return Array.from(this.subscriptions.values())
      .some(sub => sub.subscriberId === subscriberId && sub.publisherId === publisherId);
  }

  // Category operations
  async getCategories(): Promise<Category[]> {
    return Array.from(this.categories.values());
  }

  async createCategory(category: InsertCategory): Promise<Category> {
    const id = this.categoryId++;
    const newCategory: Category = { ...category, id };
    this.categories.set(id, newCategory);
    return newCategory;
  }

  // Video saving operations
  async saveVideo(id: number, userId: number): Promise<boolean> {
    const video = this.videos.get(id);
    if (!video) {
      throw new Error('Video not found');
    }

    const savedKey = `${id}_${userId}`;
    this.userSavedVideos.set(savedKey, true);
    return true;
  }

  async unsaveVideo(id: number, userId: number): Promise<boolean> {
    const video = this.videos.get(id);
    if (!video) {
      throw new Error('Video not found');
    }

    const savedKey = `${id}_${userId}`;
    this.userSavedVideos.delete(savedKey);
    return true;
  }

  async getSavedVideos(userId: number): Promise<Video[]> {
    const savedKeys = Array.from(this.userSavedVideos.keys())
      .filter(key => key.endsWith(`_${userId}`) && this.userSavedVideos.get(key));

    const videoIds = savedKeys.map(key => parseInt(key.split('_')[0]));

    return Array.from(this.videos.values())
      .filter(video => videoIds.includes(video.id))
      .sort((a, b) => b.id - a.id);
  }

  async isSaved(videoId: number, userId: number): Promise<boolean> {
    const savedKey = `${videoId}_${userId}`;
    return this.userSavedVideos.get(savedKey) || false;
  }

  // Playlist operations
  private playlists: Map<number, InsertPlaylist & { id: number, createdAt: Date }> = new Map();
  private playlistId = 1;

  async createPlaylist(playlist: InsertPlaylist): Promise<InsertPlaylist & { id: number, createdAt: Date }> {
    const id = this.playlistId++;
    const newPlaylist = {
      ...playlist,
      id,
      createdAt: new Date(),
      videos: []
    };
    this.playlists.set(id, newPlaylist);
    return newPlaylist;
  }

  async getUserPlaylists(userId: number): Promise<any[]> {
    return Array.from(this.playlists.values())
      .filter(playlist => playlist.userId === userId)
      .sort((a, b) => b.id - a.id);
  }

  async getPlaylistVideos(playlistId: number): Promise<Video[]> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist?.videos) return [];

    return playlist.videos.map(video => {
      if (typeof video === 'object' && 'position' in video) {
        return this.videos.get(video.videoId) || video;
      }
      return video;
    });
  }

  async getPlaylistById(playlistId: number): Promise<any> {
    return this.playlists.get(playlistId);
  }

  async getNextPlaylistPosition(playlistId: number): Promise<number> {
    const playlist = this.playlists.get(playlistId);
    return playlist?.videos?.length || 0;
  }

  async addVideoToPlaylist({ playlistId, videoId, position }: { playlistId: number, videoId: number, position: number }): Promise<any> {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) throw new Error('Playlist not found');

    const video = this.videos.get(videoId);
    if (!video) throw new Error('Video not found');

    if (!playlist.videos) {
      playlist.videos = [];
    }

    playlist.videos.push({
      ...video,
      position
    });

    this.playlists.set(playlistId, playlist);
    return { playlistId, videoId, position };
  }

  // Ad Network Methods
  async getAds(): Promise<Advertisement[]> {
    try {
      return Array.from(this.ads.values());
    } catch (error) {
      console.error('Error fetching ads:', error);
      return [];
    }
  }

  async createAd(ad: Partial<Advertisement>): Promise<Advertisement> {
    try {
      const id = this.adId++;
      const newAd: Advertisement = {
        id,
        name: ad.name || '',
        type: ad.type || 'pre-roll',
        content: ad.content || '',
        targetUrl: ad.targetUrl || '',
        budget: ad.budget || 0,
        cpm: ad.cpm || 0,
        impressions: 0,
        clicks: 0,
        status: ad.status || 'active',
        targeting: ad.targeting || '',
        startDate: ad.startDate || new Date(),
        endDate: ad.endDate || new Date(),
        createdAt: new Date()
      };

      this.ads.set(id, newAd);
      return newAd;
    } catch (error) {
      console.error('Error creating ad:', error);
      throw new Error('Failed to create advertisement');
    }
  }

  async getAdById(id: number): Promise<Advertisement | undefined> {
    return this.ads.get(id);
  }

  async updateAdStats(id: number, impressions: number, clicks: number): Promise<void> {
    const ad = await this.getAdById(id);
    if (ad) {
      ad.impressions += impressions;
      ad.clicks += clicks;
      this.ads.set(id, ad);
    }
  }

  async getAdStats(): Promise<AdStat[]> {
    return Array.from(this.adStats.values());
  }

  async updateAdSettings(settings: {
    defaultCpm: number;
    minimumBudget: number;
    revenuePerView: number;
    categories: string[];
  }): Promise<void> {
    // Store the settings in memory
    this.adSettings = settings;
  }

  async incrementVideoAdImpressions(videoId: number): Promise<void> {
    const video = this.videos.get(videoId);
    if (video) {
      // Ensure we're only incrementing once
      video.ad_impressions = (video.ad_impressions || 0) + 1;
      this.videos.set(videoId, video);
    }
  }

  async incrementVideoRevenue(videoId: number, amount: number, updateImpressions: boolean = false): Promise<void> {
    const video = this.videos.get(videoId);
    if (video) {
      // Update video revenue
      video.ad_revenue = (video.ad_revenue || 0) + amount;
      if (updateImpressions) {
        video.ad_impressions = (video.ad_impressions || 0) + 1;
      }
      this.videos.set(videoId, video);

      // Update user revenue with the same amount only once
      if (video.userId) {
        const user = await this.getUser(video.userId);
        if (user) {
          user.adRevenue = (user.adRevenue || 0) + amount;
          this.users.set(user.id, user);
          console.log(`Updated user ${user.id} revenue: +${amount} cents, new total: ${user.adRevenue} cents`);
        }
      }
    }
  }

  async incrementUserAdRevenue(userId: number, amount: number): Promise<void> {
    const user = await this.getUser(userId);
    if (user) {
      user.adRevenue = (user.adRevenue || 0) + amount;
      this.users.set(userId, user);
      console.log(`Updated user ${userId} revenue to ${user.adRevenue}`);
    }
  }

  async permanentlyDeleteVideo(videoId: number): Promise<void> {
    const video = this.videos.get(videoId);
    if (video) {
      // Delete from videos map completely
      this.videos.delete(videoId);

      // Delete all comments for this video
      Array.from(this.comments.entries()).forEach(([commentId, comment]) => {
        if (comment.videoId === videoId) {
          this.comments.delete(commentId);
        }
      });
    }
  }
}

export const storage = new MemStorage();