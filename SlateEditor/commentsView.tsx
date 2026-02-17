{
    "docs": [
        {
            "originalFileName": "Co-Pilot- VerticalSense.ai Requirements Gathering- 31st Oct Meeting-02.mp4",
            "fileType": "video/mp4",
            "fileSize": 65.39,
            "fileLocation": "https://sb-uat12-tenant-fa284134-tenantbucket-yicgugrke1rw.s3.us-east-1.amazonaws.com/xaas-storage/a7f78933-fbc4-44b3-9c41-1bf134985427-Co-Pilot-%20VerticalSense.ai%20Requirements%20Gathering-%2031st%20Oct%20Meeting-02.mp4%22,
            "fileKey": "xaas-storage/a7f78933-fbc4-44b3-9c41-1bf134985427-Co-Pilot- VerticalSense.ai Requirements Gathering- 31st Oct Meeting-02.mp4"
        }
    ],
    "jobType": 3,
    "tags": [
        {
            "Model": "arn:aws:bedrock:us-east-1:703585382174:application-inference-profile/1em1vxneesqh"
        },
        {
            "Prompt": "Act like a \"Standard Operating Procedure(SOP)\" Generator. \n Generate SOP based on the image and the Audio Transcript Context. \n Audio Transcript Context is conversation explaing the tool and how to use the particular screen. \n Generate step by step points on how to use or navigate the tool based on both the tool image and the conversation(Audio Transcript Context) about the tool. \n such that any new person should understand how to use the tool by looking at your response. \n **Important points : \n 1)Do not add any conclusion, just stick to conversation of the tool. \n 2)Just Only confine to image and the conversation spoken to Generate step by step points \n 3) Always use bullet points `•` for each instruction."
        },
        {
            "RegenerateMemory": false
        },
        {
            "video_header_Prompt": "Given the following file name: \"{file_name}\", extract a clean, human-readable title that could be used as a file header. Remove any numbers, file extensions, underscores, or other unnecessary characters, and capitalize each main word. \n Examples: \n 1. For a file name like \"Revitalize Tranche 2_ TA ITSM Change Management Process Refresher Training for New Suppliers-20240410_080422-Meeting Recording.mp4\", the header should be \"TA ITSM Change Management Process Refresher Training for New Suppliers\". \n 2. For a file name like \"T2-G.13-LifeCom_ KT for MCAS Project-20240305_100501-Meeting Recording.mp4\", the header should be \"KT for MCAS Project\". \n 3. For a file name like \"T2-G.13-LifeCom_ Functional Overview-20240118_070254-Meeting Recording.mp4\", the header should be \"LifeCom_ Functional Overview\". \n Don't hallucinate and give vague response, give a suitable title using the file name provided only, and the response should not contain any characters other than [a-z,A-Z]. \n File name: \"{file_name}\" \n Header:"
        },
        {
            "video_subheader_Prompt": "For each item below, generate only a concise heading based on the provided image and text context. The image is encoded in base64 format, and the text context describes details related to the image. Focus on creating a short, relevant title—aim for a few words only. \n Example: \n - **Image (Base64 Encoded)**: iVBORw0KGgoAAAANSUhEUgAAAOEAAADhCAYAAAA8... \n- **Text Context**: \"A beautiful sunrise over the mountains with a clear blue sky. The golden rays illuminate the entire landscape, creating a serene and inspiring scene.\" \n**Expected Heading**: Mountain Sunrise \n --- \n Now, generate a heading based on the following details and output only the heading:"
        },
        {
            "video_summary_prompt": "Create high level summary of the uploaded transcript under different headers. Don't add special characters like * unless mentioned in the source"
        },
        {
            "junk_removal_prompt": "You are tasked with processing Standard Operating Procedure (SOP) points based on the provided image and context. However, do not generate any introductory or concluding statements for any image. Specifically, you must: \n Strictly avoid generating any of the following types of sentences in the SOP: \n \"Here are the steps for the tool based on the provided image and context.\" \n \"Here is the Standard Operating Procedure in bullet points based on the image and conversation.\" \n \"Based on the image and context provided, here is the SOP in bullet points.\" \n Strictly avoid generating any general instructions that are unrelated to the specific tool's use, such as: \n Instructions on basic meeting actions (e.g., \"joining,\" \"leaving,\" \"saying 'hello,' 'hi,' 'bye'\"). \n Details on screen sharing or content sharing, including instructions like \"Click on the Share content icon\" or similar. \n References to opening or navigating documents or spreadsheets without providing specific tool usage steps (e.g., \"Open the Excel workbook,\" \"Go to the Excel sheet\"). \n Instructions that involve reviewing, scrolling, or interacting with file previews in a non-tool-specific way (e.g., \"Click on the image thumbnail to enlarge the preview,\" \"Use the toolbar options like comments, editing, and share\"). \n Additionally, if the provided image shows a meeting screen with only participants (such as a Teams meeting screen with no tool functionality shown, image appears to show a video conferencing or online meeting interface, circular icons or avatars representing different individuals, icons display initials such as DS, SK, LH, WD, HR, KJ, and SV, possibly representing the participants), or the associated transcript mainly discusses basic actions like \"joining,\" \"leaving,\" \"hello,\" \"hi,\" \"bye,\" \"screen sharing,\" or similar actions (e.g., \"Click on the 'Share' icon at the top toolbar\", \"Click on a participant's icon to manage audio and video settings for that individual\", \"Use the controls at the bottom (e.g. mute, video on/off) to adjust your own audio and video\", \"Click the \"Share\" icon to share your screen or content\", \"Click the \"More Options (...) icon to access additional features like recording, virtual backgrounds\",\"To mute or unmute your microphone\", \"turn your camera on or off\",\"click the microphone icon\"): \n\n  **Do not classify the image as junk even if the transcript is irrelevant** to the tool or image, even if it appears unrelated to the specific tool’s function. Only classify the image as \"junk\" and return the string 'junk' when the image clearly lacks any relevant tool usage steps or is purely related to basic meeting actions or participant interaction, with no functional tool information. \n\n The goal is to return a clean and direct SOP based on the image content, without any unnecessary or generic sentences. If the image is deemed irrelevant or unhelpful based on the criteria above(e.g., meeting screen with only participants or irrelevant actions), return 'junk'. \n\n **Always use bullet points (•) for SOP steps. Do not use numbered points (1., 2., etc.).**"
        },
        {
            "Unified_subheader_prompt": "Given a list of headings, group similar topics under a common category label. If multiple headings belong to the same category, assign them the same category. If a heading represents a distinct or unique topic, create a unique category for it. The output should be in the following format: \n 1.[Category Name] \n 1.[Heading 1] \n 3.[Heading 2] \n 6.[Heading 3] \n (and so on, for each group of similar headings) \n Example Input: \n 1.Data Mapping for Compliance Reporting \n 2.Insurance Compliance Questionnaire \n 3.Legal Compliance Review \n 4.Insurance Data Extraction \n 5.CMS Health Plan Data Requirements \n 6.Insurance Data Analysis \n Example Output: \n 1.Data Mapping and Compliance \n 2.Data Mapping for Compliance Reporting \n 4.Legal Compliance Review \n 2.Insurance Data \n 5.Insurance Compliance Questionnaire \n 8.Insurance Data Extraction \n 9.Insurance Data Analysis \n 3.Data Extraction and Requirements \n 1.CMS Health Plan Data Requirements"
        },
        {
            "video_document_type": "sop"
        },
        {
            "generate_type": "sop"
        },
        {
            "ProjectId": "aef6e239-fdaf-44c7-bd41-df893a62417d"
        },
        {},
        {
            "DemoName": "BA Copilot"
        },
        {
            "UseCase": "video"
        },
        {
            "ProjectName": "New Sop for Testing"
        }
    ]
}
