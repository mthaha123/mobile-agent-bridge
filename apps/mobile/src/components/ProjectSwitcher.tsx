/**
 * ProjectSwitcher — 项目目录切换组件
 *
 * 允许用户选择和切换项目目录
 */
import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useProjectStore } from '../stores/projectStore'
import { useAuthStore } from '../stores/authStore'
import { useFileStore } from '../stores/fileStore'

interface ProjectSwitcherProps {
  onDismiss?: () => void
}

export const ProjectSwitcher: React.FC<ProjectSwitcherProps> = ({ onDismiss }) => {
  const {
    directory,
    project,
    switching,
    switchProject,
    fetchCurrentProject,
  } = useProjectStore()

  const client = useAuthStore((s) => s.client)
  const { files, setFiles, setLoading, setError } = useFileStore()

  const [inputPath, setInputPath] = useState(directory || '')
  const [showBrowser, setShowBrowser] = useState(false)
  const [currentBrowsePath, setCurrentBrowsePath] = useState('/')
  const [browseLoading, setBrowseLoading] = useState(false)

  // 获取当前项目信息
  useEffect(() => {
    fetchCurrentProject()
  }, [])

  // 更新输入框
  useEffect(() => {
    setInputPath(directory || '')
  }, [directory])

  // 浏览目录
  const browseDirectory = async (path: string) => {
    if (!client) return

    setBrowseLoading(true)
    try {
      const items = await client.listFiles(path)
      const dirs = items.filter(item => item.type === 'directory')
      setFiles(dirs)
      setCurrentBrowsePath(path)
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to browse directory')
    } finally {
      setBrowseLoading(false)
    }
  }

  // 切换项目
  const handleSwitch = async () => {
    if (!inputPath.trim()) {
      Alert.alert('Error', 'Please enter a directory path')
      return
    }

    await switchProject(inputPath.trim())
    onDismiss?.()
  }

  // 选择目录
  const handleSelectDirectory = (path: string) => {
    setInputPath(path)
    setShowBrowser(false)
  }

  // 进入目录
  const handleEnterDirectory = (dirName: string) => {
    const newPath = currentBrowsePath.endsWith('/')
      ? currentBrowsePath + dirName
      : currentBrowsePath + '/' + dirName
    browseDirectory(newPath)
  }

  // 返回上级目录
  const handleGoUp = () => {
    const parts = currentBrowsePath.split('/').filter(Boolean)
    if (parts.length > 0) {
      parts.pop()
      const newPath = '/' + parts.join('/') || '/'
      browseDirectory(newPath)
    }
  }

  return (
    <View style={styles.container}>
      {/* 当前项目信息 */}
      <View style={styles.currentProject}>
        <Text style={styles.label}>Current Project</Text>
        <Text style={styles.currentPath} numberOfLines={1}>
          {directory || 'No project selected'}
        </Text>
        {project?.name && (
          <Text style={styles.projectName}>{project.name}</Text>
        )}
      </View>

      {/* 输入框 */}
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputPath}
          onChangeText={setInputPath}
          placeholder="Enter project directory path..."
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={styles.browseButton}
          onPress={() => {
            setShowBrowser(!showBrowser)
            if (!showBrowser) {
              browseDirectory(currentBrowsePath)
            }
          }}
        >
          <Text style={styles.browseButtonText}>Browse</Text>
        </TouchableOpacity>
      </View>

      {/* 目录浏览器 */}
      {showBrowser && (
        <View style={styles.browser}>
          <View style={styles.browserHeader}>
            <Text style={styles.browserPath} numberOfLines={1}>
              {currentBrowsePath}
            </Text>
            {currentBrowsePath !== '/' && (
              <TouchableOpacity style={styles.upButton} onPress={handleGoUp}>
                <Text style={styles.upButtonText}>↑ Up</Text>
              </TouchableOpacity>
            )}
          </View>

          {browseLoading ? (
            <ActivityIndicator size="small" color="#007AFF" style={styles.loading} />
          ) : (
            <FlatList
              data={files}
              keyExtractor={(item) => item.name}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.browserItem}
                  onPress={() => handleEnterDirectory(item.name)}
                >
                  <Text style={styles.browserItemIcon}>📁</Text>
                  <Text style={styles.browserItemName}>{item.name}</Text>
                </TouchableOpacity>
              )}
              style={styles.browserList}
            />
          )}

          <TouchableOpacity
            style={styles.selectButton}
            onPress={() => handleSelectDirectory(currentBrowsePath)}
          >
            <Text style={styles.selectButtonText}>Select This Directory</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 操作按钮 */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.cancelButton]}
          onPress={onDismiss}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.switchButton, switching && styles.disabledButton]}
          onPress={handleSwitch}
          disabled={switching}
        >
          {switching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.switchButtonText}>Switch Project</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    margin: 16,
    maxHeight: '80%',
  },
  currentProject: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
  },
  label: {
    color: '#888',
    fontSize: 12,
    marginBottom: 4,
  },
  currentPath: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  projectName: {
    color: '#007AFF',
    fontSize: 12,
    marginTop: 4,
  },
  inputContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  input: {
    flex: 1,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    marginRight: 8,
  },
  browseButton: {
    backgroundColor: '#333',
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  browseButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  browser: {
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    marginBottom: 12,
    maxHeight: 300,
  },
  browserHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  browserPath: {
    color: '#fff',
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  upButton: {
    padding: 4,
  },
  upButtonText: {
    color: '#007AFF',
    fontSize: 12,
  },
  loading: {
    padding: 20,
  },
  browserList: {
    maxHeight: 200,
  },
  browserItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  browserItemIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  browserItemName: {
    color: '#fff',
    fontSize: 14,
  },
  selectButton: {
    padding: 12,
    backgroundColor: '#007AFF',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  selectButtonText: {
    color: '#fff',
    textAlign: 'center',
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  cancelButton: {
    backgroundColor: '#333',
  },
  cancelButtonText: {
    color: '#fff',
  },
  switchButton: {
    backgroundColor: '#007AFF',
  },
  switchButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
})
