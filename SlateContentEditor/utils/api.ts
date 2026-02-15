const API_ENDPOINT = "/api/save";

export const submitJson = async (json: Record<string, any>): Promise<any> => {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json),
    });
    const result = await response.json();
    console.log("API response:", result);
    return result;
  } catch (error) {
    console.error("API error:", error);
    throw error;
  }
};
