import React, { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native'
import { useFileStore, FileInfo, SearchResult } from '../stores/fileStore'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'

export const FileBrowserScreen: React.FC = () => {
  const {
    currentPath,
    files,
    currentFile,
    searchResults,
    searchQuery,
    loading,
    error,
    setCurrentPath,
    setFiles,
    setCurrentFile,
    setSearchResults,
    setSearchQuery,
    setLoading,
    setError,
    goUp,
    enterDirectory,
  } = useFileStore()

  const client = useAuthStore((s) => s.client)
  const projectDir = useProjectStore((s) => s.directory)
  const setScreen = useUiStore((s) => s.setScreen)

  const loadDirectory = useCallback(async (path: string) => {
    if (!client) return

    setLoading(true)
    setError(null)
    setCurrentFile(null)

    try {
      const files = await client.listFiles(path)
      setFiles(files)
    } catch (err: any) {
      setError(err.message || 'Failed to load directory')
      Alert.alert('Error', err.message || 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }, [client, setFiles, setLoading, setError, setCurrentFile])

  useEffect(() => {
    const initialPath = projectDir || '/'
    setCurrentPath(initialPath)
    loadDirectory(initialPath)
  }, [projectDir])

  useEffect(() => {
    if (currentPath) {
      loadDirectory(currentPath)
    }
  }, [currentPath])

  const handleFilePress = async (file: FileInfo) => {
    if (file.type === 'directory') {
      enterDirectory(file.name)
    } else if (file.type === 'file') {
      setLoading(true)
      try {
        const content = await client?.readFile(currentPath + '/' + file.name)
        setCurrentFile(content || null)
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to read file')
      } finally {
        setLoading(false)
      }
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() || !client) return

    setLoading(true)
    setError(null)

    try {
      const results = await client.searchFiles(searchQuery, { dirs: [currentPath] })
      setSearchResults(results)
    } catch (err: any) {
      setError(err.message || 'Search failed')
      Alert.alert('Error', err.message || 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  const handleBack = () => {
    setScreen('sessions')
  }

  const renderFileItem = ({ item }: { item: FileInfo }) => (
    <TouchableOpacity
      style={styles.fileItem}
      onPress={() => handleFilePress(item)}
    >
      <Text style={styles.fileIcon}>
        {item.type === 'directory' ? '📁' : item.type === 'symlink' ? '🔗' : '📄'}
      </Text>
      <View style={styles.fileInfo}>
        <Text style={styles.fileName}>{item.name}</Text>
        <Text style={styles.fileMeta}>
          {item.type === 'directory' ? 'Directory' : formatSize(item.size)}
          {item.permissions ? ` • ${item.permissions}` : ''}
        </Text>
      </View>
      {item.type === 'directory' && <Text style={styles.chevron}>›</Text>}
    </TouchableOpacity>
  )

  const renderSearchResult = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity
      style={styles.searchResult}
      onPress={() => {
        Alert.alert('File', `${item.file}:${item.line}`)
      }}
    >
      <Text style={styles.searchFile}>{item.file}</Text>
      <Text style={styles.searchLine}>Line {item.line}</Text>
      <Text style={styles.searchContent} numberOfLines={2}>
        {item.content}
      </Text>
    </TouchableOpacity>
  )

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {currentPath}
        </Text>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search files..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      {currentFile && (
        <View style={styles.filePreview}>
          <View style={styles.filePreviewHeader}>
            <Text style={styles.filePreviewTitle} numberOfLines={1}>
              {currentFile.path}
            </Text>
            <TouchableOpacity onPress={() => setCurrentFile(null)}>
              <Text style={styles.closePreview}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.codeContainer}>
            <Text style={styles.codeContent}>{currentFile.content}</Text>
          </ScrollView>
        </View>
      )}

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4a9eff" />
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {searchResults.length > 0 && !loading && (
        <FlatList
          data={searchResults}
          renderItem={renderSearchResult}
          keyExtractor={(item, index) => `${item.file}-${item.line}-${index}`}
          style={styles.list}
        />
      )}

      {!loading && searchResults.length === 0 && (
        <FlatList
          data={files}
          renderItem={renderFileItem}
          keyExtractor={(item) => item.name}
          style={styles.list}
          ListHeaderComponent={
            currentPath !== '/' ? (
              <TouchableOpacity style={styles.fileItem} onPress={goUp}>
                <Text style={styles.fileIcon}>📁</Text>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName}>..</Text>
                  <Text style={styles.fileMeta}>Parent Directory</Text>
                </View>
              </TouchableOpacity>
            ) : null
          }
        />
      )}
    </View>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#0f3460',
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  backButton: {
    marginRight: 12,
  },
  backText: {
    color: '#4a9eff',
    fontSize: 16,
  },
  title: {
    flex: 1,
    color: '#eee',
    fontSize: 16,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 10,
    color: '#eee',
    marginRight: 8,
  },
  searchButton: {
    backgroundColor: '#4a9eff',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  fileIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: '#eee',
    fontSize: 16,
  },
  fileMeta: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: '#888',
    fontSize: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    padding: 12,
    backgroundColor: '#3a1a1a',
  },
  errorText: {
    color: '#ff6b6b',
  },
  filePreview: {
    flex: 1,
    backgroundColor: '#16213e',
  },
  filePreviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#0f3460',
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  filePreviewTitle: {
    color: '#eee',
    fontSize: 14,
    flex: 1,
    marginRight: 12,
  },
  closePreview: {
    color: '#888',
    fontSize: 18,
  },
  codeContainer: {
    flex: 1,
    padding: 12,
  },
  codeContent: {
    color: '#d4d4d4',
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
  },
  searchResult: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  searchFile: {
    color: '#4a9eff',
    fontSize: 14,
  },
  searchLine: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  searchContent: {
    color: '#eee',
    fontSize: 14,
    marginTop: 4,
  },
})
