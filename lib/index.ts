import * as Figma from "../types/FigmaApi"
import axios, { AxiosInstance } from "axios"
import * as Markup from "markup-js"

import { rgbaToStr, gradientToStr } from "./helpers"
import templates from "./templates"

interface Settings {
	token: string
}

interface Attribute {
	name: string
	value?: string
	values?: string[]
}

type Token = "colors" | "space" | "icons" | "fontSizes" | "fonts" | "fontWeights" | "illustrations"

type Tokens = {
	[key in Token]: Object
}

const defaultTokens: Token[] = ["colors", "space", "fontSizes", "fonts", "fontWeights"]

type TokenSingulars = {
	[key in Token]: string
}

const tokenSingulars: TokenSingulars = {
	colors: "color",
	space: "space",
	fontSizes: "size",
	fonts: "family",
	fontWeights: "weight",
  icons: "icon",
  illustrations: "illustration",
}

class FigmaParser {
	private client: AxiosInstance
	private fileId: String
	private tokens: Token[]
	public output: Tokens

	constructor(settings: Settings) {
		this.client = axios.create({
			baseURL: `https://api.figma.com/v1/`,
			headers: {
				"X-Figma-Token": settings.token
			}
		})
	}

	/**
	 * Trigger parse and apply template
	 */
	parse = async (fileId: string, tokens: Token[]): Promise<Tokens> => {
		this.fileId = fileId
		this.tokens = tokens || defaultTokens

		this.output = {
			colors: {},
			space: {},
			icons: {},
			fonts: {},
			fontWeights: {},
      fontSizes: {},
      illustrations: {},
		}

		const document = await this.request()

		if (!document) {
			throw new Error("Error loading file")
		}

		const pageList = document.children

		await this.parseTree(pageList)

		return this.output
	}

	/**
	 * Format token output to a markup template
	 */
	markup = (template?: string, input?: Tokens): string => {
		if (!input) {
			input = this.output
		}

		for (let token in input) {
			if (Object.keys(input[token]).length === 0) {
				delete input[token]
			}
		}

		const arrayInput = Object.keys(input)
			.map(token => ({ token, singular: tokenSingulars[token], attributes: Object.keys(input[token]).map(attr => ({ name: attr, value: input[token].attr })) }))
			.filter(item => item.attributes.length > 0)

		if (template === "json") {
			return JSON.stringify(input, null, 2)
		}

		let result = Markup.up(template ? templates[template] || template : templates.ts, { tokens: arrayInput })

		return result
	}

	/**
	 * Make an API request call
	 */
	request = async (): Promise<Figma.Document> => {
		return this.client
			.get(`files/${this.fileId}`)
			.then(data => {
				return data.data.document as Figma.Document
			})
			.catch(error => {
				return error.data.status
			})
	}

	/**
	 * Make an API request call
	 */
	getImage = async (imageId: string): Promise<String> => {
		const response = await this.client.get(`images/${this.fileId}?ids=${imageId}&format=svg`)

		if (response.data.images[imageId]) {
			const { data } = await axios.get(response.data.images[imageId], { responseType: "text" })
			return data
		}
	}

	/**
	 * Parse provided Page following parse rules
	 */
	private parseTree = async (pages: ReadonlyArray<Figma.Canvas | Figma.FrameBase | Figma.Node>): Promise<void> => {
		for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
			const page = pages[pageIndex]

			if (page.type === "INSTANCE") {
				continue
			}

			if (page["children"]) {
				await this.parseTree(page["children"])
			}

			const layer = page["children"] ? page["children"][0] : page

			const nameParts = page.name.split("-")

			if (nameParts.length < 2) {
				continue
			}

			const role = nameParts[0]

			/**
			 * Colors
			 */
			if (this.tokens.indexOf("colors") > -1 && role === "color" && layer["fills"]) {
				const fill = layer["fills"][0]

				const value = fill.type === "SOLID" ? rgbaToStr(fill.color, fill.opacity || 1) : gradientToStr(fill.gradientStops)

				if (value) {
					this.output.colors[nameParts.slice(1).join("")] = value
				}
			}

			/**
			 * Space
			 */
			if (this.tokens.indexOf("space") > -1 && role === "spacing" && layer["absoluteBoundingBox"]) {
				this.output.space[`${nameParts.slice(1).join("")}`] = `${layer["absoluteBoundingBox"]["height"]}px`
			}

			/**
			 * Font
			 */
			if (role === "font" && layer["style"]) {
				if (this.tokens.indexOf("fonts") > -1 && nameParts[1] === "family") {
					this.output.fonts[nameParts.length > 2 ? nameParts.slice(2).join("") : "default"] = layer["style"]["fontFamily"]
				}

				if (this.tokens.indexOf("fontSizes") > -1 && nameParts[1] === "style") {
					this.output.fontSizes[nameParts.slice(2).join("")] = `${layer["style"]["fontSize"]}px`
				}

				if (this.tokens.indexOf("fontWeights") > -1 && nameParts[1] === "style") {
					this.output.fontWeights[nameParts.slice(2).join("")] = layer["style"]["fontWeight"]
				}
      }

      /**
			 * Icon
			 */
			if (this.tokens.indexOf("icons") > -1 && role === "icon") {
				try {
					const image = await this.getImage(page.id)
					const paths = image.match(/d="(.[^"]+)"/g)
					if (paths.length > 0) {
						this.output.icons[nameParts.slice(1).join("")] = paths.map(path => path.substr(3, path.length - 4))
					}
				} catch (err) {}
			}

      /**
       * Illustrations
       */
      if (this.tokens.indexOf("illustrations") > -1 && role === "illustration") {
        try {
          const image = await this.getImage(page.id)
          const illustrationName = nameParts.map(name => name.charAt(0).toUpperCase() + name.slice(1));
          this.output.illustrations[illustrationName.slice(1).join("")] = image
				} catch (err) {}
			}
		}
	}
}

export = FigmaParser
