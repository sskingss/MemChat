/**
 * MemChat API Usage Examples
 *
 * This file demonstrates how to interact with the MemChat API
 */

const API_BASE = 'http://localhost:3000';

// Helper function to make API requests
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'API request failed');
  }

  return response.json();
}

// Example 1: User Registration
async function registerUser(username) {
  console.log(`\n📝 Registering user: ${username}`);

  const data = await apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username }),
  });

  console.log('✅ Registration successful!');
  console.log(`   User ID: ${data.userId}`);
  console.log(`   Token: ${data.token.substring(0, 20)}...`);

  return data;
}

// Example 2: Send a chat message
async function sendMessage(token, workspaceId, message) {
  console.log(`\n💬 Sending message: "${message}"`);

  const data = await apiRequest('/api/chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      workspaceId,
      message,
    }),
  });

  console.log('🤖 AI Response:');
  console.log(`   ${data.response}`);
  console.log(`   Memories used: ${data.memoriesUsed}`);
  console.log(`   Memories stored: ${data.memoriesStored}`);

  return data;
}

// Example 3: Get all memories
async function getMemories(token, workspaceId) {
  console.log(`\n🧠 Fetching memories for workspace: ${workspaceId}`);

  const data = await apiRequest(`/api/memories?workspaceId=${workspaceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  console.log(`✅ Found ${data.count} memories:`);
  data.memories.forEach((memory, index) => {
    console.log(`   ${index + 1}. ${memory.content}`);
  });

  return data;
}

// Example 4: Update a memory
async function updateMemory(token, memoryId, newContent) {
  console.log(`\n✏️  Updating memory: ${memoryId}`);

  const data = await apiRequest(`/api/memories/${memoryId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content: newContent }),
  });

  console.log('✅ Memory updated successfully!');

  return data;
}

// Example 5: Delete a memory
async function deleteMemory(token, memoryId) {
  console.log(`\n🗑️  Deleting memory: ${memoryId}`);

  const data = await apiRequest(`/api/memories/${memoryId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  console.log('✅ Memory deleted successfully!');

  return data;
}

// Main demo function
async function main() {
  try {
    console.log('🚀 MemChat API Demo\n');
    console.log('=' .repeat(50));

    // 1. Register a new user
    const { userId, token } = await registerUser('demo_user');

    // 2. Have a conversation
    const workspaceId = 'demo_workspace';

    await sendMessage(token, workspaceId, 'Hi! I prefer TypeScript for backend development.');
    await sendMessage(token, workspaceId, 'I work at a tech company in Beijing.');
    await sendMessage(token, workspaceId, 'What programming language do I prefer?');

    // 3. View stored memories
    const memoriesData = await getMemories(token, workspaceId);

    // 4. Update a memory (if any exist)
    if (memoriesData.memories.length > 0) {
      const firstMemory = memoriesData.memories[0];
      await updateMemory(token, firstMemory.id, 'Updated: User loves TypeScript!');
    }

    // 5. View memories again
    await getMemories(token, workspaceId);

    console.log('\n' + '='.repeat(50));
    console.log('✨ Demo completed successfully!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nMake sure:');
    console.error('  1. The server is running (npm run dev)');
    console.error('  2. Milvus is running (docker-compose up -d)');
    console.error('  3. Environment variables are configured (.env)');
  }
}

// Run the demo
main();
