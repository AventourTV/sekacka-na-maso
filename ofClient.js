'use strict';
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const { OF_API_KEY } = require('./config');

const OF_API_BASE = 'https://app.onlyfansapi.com/api';

class OFClient {
  constructor(tenant, log) {
    this.tenant = tenant; // tenant.of_user_id will be the account ID (acct_...)
    this.log = log;
    this._http = this._buildHttp();
  }

  _buildHttp() {
    const accountId = this.tenant.of_user_id;

    const instance = axios.create({
      baseURL: OF_API_BASE,
      timeout: 60000, // Increase to 60s
      headers: {
        'Authorization': `Bearer ${OF_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    axiosRetry(instance, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) =>
        axiosRetry.isNetworkOrIdempotentRequestError(err) ||
        (err.response && err.response.status >= 500),
    });

    return instance;
  }

  async _call(method, url, opts = {}) {
    try {
      const res = await this._http[method](url, opts);
      return res.data;
    } catch (err) {
      this.log.error(`API Error [${method.toUpperCase()} ${url}]: ${err.response?.data?.message || err.message}`);
      throw err;
    }
  }

  // ------------------------------------------------------------------

  async getChats() {
    try {
      // Endpoint: GET /api/{account}/chats
      const data = await this._call('get', `/${this.tenant.of_user_id}/chats`);
      return Array.isArray(data?.data) ? data.data : [];
    } catch (err) {
      this.log.error(`getChats failed: ${err.message}`);
      return [];
    }
  }

  async getMessages(fanUserId, limit = 20) {
    try {
      // Endpoint: GET /api/{account}/chats/{chat_id}/messages
      const data = await this._call('get', `/${this.tenant.of_user_id}/chats/${fanUserId}/messages?limit=${limit}`);
      const msgs = Array.isArray(data?.data) ? data.data : [];
      return msgs.reverse();
    } catch (err) {
      this.log.error(`getMessages failed for ${fanUserId}: ${err.message}`);
      return [];
    }
  }

  async sendMessage(fanUserId, text) {
    try {
      // Endpoint: POST /api/{account}/chats/{chat_id}/messages
      await this._call('post', `/${this.tenant.of_user_id}/chats/${fanUserId}/messages`, { text });
      this.log.info(`Message sent to fan ${fanUserId}`);
      return true;
    } catch (err) {
      this.log.error(`sendMessage failed for ${fanUserId}: ${err.message}`);
      return false;
    }
  }

  static chatHasUnread(chat) {
    // documentation shows unreadMessagesCount, but let's be safe
    return (chat?.unreadMessagesCount || chat?.unread_count || 0) > 0;
  }

  static lastMessageIsFromFan(chat) {
    const last = chat?.lastMessage || chat?.last_message;
    if (!last) return false;
    
    const fanId = chat?.fan?.id;
    
    // 1. Check for boolean 'fromUser' (older/standard OF format)
    if (last.fromUser === true) return true;
    
    // 2. Check for boolean 'is_from_me' (newer/API wrapper format)
    if (last.is_from_me === false) return true;
    
    // 3. Check for object 'fromUser' (OnlyFansAPI.com format)
    // If the sender's ID matches the fan's ID, it's from the fan.
    if (last.fromUser && typeof last.fromUser === 'object') {
      if (fanId && String(last.fromUser.id) === String(fanId)) return true;
    }
    
    return false;
  }
}

module.exports = OFClient;
