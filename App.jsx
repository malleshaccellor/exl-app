import { useMemo, useState } from 'react'
import SlateEditor from './components/SlateEditorHtml'
import { jsonToSlateValue } from './components/SlateEditorHtml/utils/jsonConversion'
import { slateValueToJson } from './components/SlateEditorHtml/utils/jsonConversion'
import {
  parseAgentResponse,
  testCasesToSlateValue,
  actionLogToSlateValue,
  summaryToSlateValue,
  brdToSlateValue,
  slateToTestCasesJson,
  slateToActionLogJson,
  slateToSummaryJson,
  slateToBrdJson,
} from './components/SlateEditorHtml/utils/dataConversions'
import './App.css'

import userStoryJson from '../jsondocs/userStory.json'
import testCasesJson from '../jsondocs/testcases.json'
import actionLogJson from '../jsondocs/actionLog.json'
import summaryJson from '../jsondocs/sumarryJson.json'
import brdJson from '../jsondocs/brd_response 2.json'

const TABS = [
  { key: 'userstories', label: 'User Stories' },
  { key: 'testcases', label: 'Test Cases' },
  { key: 'actionlog', label: 'Action Log' },
  { key: 'summary', label: 'Summary' },
  { key: 'brd', label: 'BRD' },
]

const serializers = {
  userstories: slateValueToJson,
  testcases: slateToTestCasesJson,
  actionlog: slateToActionLogJson,
  summary: slateToSummaryJson,
  brd: slateToBrdJson,
}

function App() {
  const [activeTab, setActiveTab] = useState('userstories')

  const slateValues = useMemo(() => {
    const userStoryData = parseAgentResponse(userStoryJson.data.UserStory_Agent.response)
    const testCasesData = parseAgentResponse(testCasesJson.data.TestCases_Agent.response)
    const actionLogData = parseAgentResponse(actionLogJson.data.ActionLog_Agent.response)
    const summaryText = summaryJson.data.Summarization_Agent.response
    const brdRaw = brdJson.data.BRD_Agent.response

    return {
      userstories: jsonToSlateValue(userStoryData),
      testcases: testCasesToSlateValue(testCasesData),
      actionlog: actionLogToSlateValue(actionLogData),
      summary: summaryToSlateValue(summaryText),
      brd: brdToSlateValue(brdRaw),
    }
  }, [])

  return (
    <div>
      <h1>Slate Editor</h1>
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #ddd', marginBottom: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid #1976d2' : '2px solid transparent',
              background: activeTab === tab.key ? '#e3f2fd' : 'transparent',
              color: activeTab === tab.key ? '#1976d2' : '#666',
              fontWeight: activeTab === tab.key ? 'bold' : 'normal',
              cursor: 'pointer',
              fontSize: '14px',
              marginBottom: '-2px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map(tab => (
        <div key={tab.key} style={{ display: activeTab === tab.key ? 'block' : 'none' }}>
          <SlateEditor
            defaultValue={slateValues[tab.key]}
            onSave={(nodes) => {
              const json = serializers[tab.key](nodes)
              console.log(`Save [${tab.label}]:`)
              console.log(JSON.stringify(json, null, 2))
            }}
            onDiscard={() => console.log(`Discard [${tab.label}]`)}
          />
        </div>
      ))}
    </div>
  )
}

export default App
