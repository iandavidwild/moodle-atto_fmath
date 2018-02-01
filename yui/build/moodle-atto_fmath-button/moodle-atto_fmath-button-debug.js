YUI.add('moodle-atto_fmath-button', function (Y, NAME) {

// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * @package    atto_fmath
 * @copyright  2018 Ian Wild  <ianwild@luminaconsultancy.com>
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Atto text editor equation plugin based on fmath.
 */

/**
 * Atto fmath equation editor.
 *
 * @namespace M.atto_fmath
 * @class Button
 * @extends M.editor_atto.EditorPlugin
 */
var COMPONENTNAME = 'atto_fmath',
    LOGNAME = 'atto_fmath',
    CSS = {
        FMATH_TEXT: 'atto_fmath_equation',
        FMATH_PREVIEW: 'atto_fmath_preview',
        SUBMIT: 'atto_fmath_submit',
        LIBRARY: 'atto_fmath_library',
        LIBRARY_GROUPS: 'atto_fmath_groups',
        LIBRARY_GROUP_PREFIX: 'atto_fmath_group'
    },
    SELECTORS = {
        LIBRARY: '.' + CSS.LIBRARY,
        LIBRARY_GROUP: '.' + CSS.LIBRARY_GROUPS + ' > div > div',
        MATH_TEXT: '.' + CSS.MATH_TEXT,
        MATH_PREVIEW: '.' + CSS.MATH_PREVIEW,
        SUBMIT: '.' + CSS.SUBMIT,
        LIBRARY_BUTTON: '.' + CSS.LIBRARY + ' button'
    },
    DELIMITERS = {
        START: '\\(',
        END: '\\)'
    },
    TEMPLATES = {
        FORM: '' +
            '<form class="atto_form">' +
                '{{{library}}}' +
                 '<div class="mdl-align">' +
                    '<br/>' +
                    '<button class="{{CSS.SUBMIT}}">{{get_string "saveequation" component}}</button>' +
                '</div>' +
            '</form>',
        LIBRARY: '' +
            '<div class="{{CSS.LIBRARY}}">' +
            '<iframe data-resolved-equation="" id="editorIFrame" style="width:100%;height:420px" src="' + M.cfg.wwwroot + '/lib/editor/atto/plugins/fmath/editor/onlyEditor.html"></iframe>' +
            '</div>'
    };

Y.namespace('M.atto_fmath').Button = Y.Base.create('button', Y.M.editor_atto.EditorPlugin, [], {

    /**
     * The selection object returned by the browser.
     *
     * @property _currentSelection
     * @type Range
     * @default null
     * @private
     */
    _currentSelection: null,

    /**
     * The cursor position in the equation textarea.
     *
     * @property _lastCursorPos
     * @type Number
     * @default 0
     * @private
     */
    _lastCursorPos: 0,

    /**
     * A reference to the dialogue content.
     *
     * @property _content
     * @type Node
     * @private
     */
    _content: null,

    /**
     * The source equation we are editing in the text.
     *
     * @property _sourceEquation
     * @type Object
     * @private
     */
    _sourceEquation: null,

    /**
     * A reference to the tab focus set on each group.
     *
     * The keys are the IDs of the group, the value is the Node on which the focus is set.
     *
     * @property _groupFocus
     * @type Object
     * @private
     */
    _groupFocus: null,

    /**
     * Regular Expression patterns used to pick out the equations in a String.
     *
     * @property _equationPatterns
     * @type Array
     * @private
     */
    _equationPatterns: [
        // We use space or not space because . does not match new lines.
        // $$ blah $$.
        /\$\$([\S\s]+?)\$\$/,
        // E.g. "\( blah \)".
        /\\\(([\S\s]+?)\\\)/,
        // E.g. "\[ blah \]".
        /\\\[([\S\s]+?)\\\]/,
        // E.g. "[tex] blah [/tex]".
        /\[tex\]([\S\s]+?)\[\/tex\]/
    ],

    initializer: function() {
        this._groupFocus = {};

        // If there is a tex filter active - enable this button.
        if (this.get('texfilteractive')) {
            // Add the button to the toolbar.
            this.addButton({
                icon: 'e/math',
                callback: this._displayDialogue
            });

            // We need custom highlight logic for this button.
            this.get('host').on('atto:selectionchanged', function() {
                if (this._resolveEquation()) {
                    this.highlightButtons();
                } else {
                    this.unHighlightButtons();
                }
            }, this);

            // We need to convert these to a non dom node based format.
            this.editor.all('tex').each(function(texNode) {
                var replacement = Y.Node.create('<span>' +
                        DELIMITERS.START + ' ' + texNode.get('text') + ' ' + DELIMITERS.END +
                        '</span>');
                texNode.replace(replacement);
            });
        }

    },

    /**
     * Display the equation editor.
     *
     * @method _displayDialogue
     * @private
     */
    _displayDialogue: function() {
        this._currentSelection = this.get('host').getSelection();

        if (this._currentSelection === false) {
            return;
        }

        var dialogue = this.getDialogue({
            headerContent: M.util.get_string('pluginname', COMPONENTNAME),
            focusAfterHide: true,
            width: 1100
        });

        // This needs to be done before the dialogue is opened because the focus will shift to the dialogue.
        var equation = this._resolveEquation();
        
        var content = this._getDialogueContent();
        
        // set the resolved equation attribute in the iframe
        var frame = content.one("#editorIFrame");
        frame.setAttribute('data-resolved-equation', equation);
        
        dialogue.set('bodyContent', content);

        dialogue.show();

        // Notify the filters about the modified nodes.
        require(['core/event'], function(event) {
            event.notifyFilterContentUpdated(dialogue.get('boundingBox').getDOMNode());
        });

        
    },

    /**
     * If there is selected text and it is part of an equation,
     * extract the equation (and set it in the form).
     *
     * @method _resolveEquation
     * @private
     * @return {String|Boolean} The equation or false.
     */
    _resolveEquation: function() {

        // Find the equation in the surrounding text.
        var selectedNode = this.get('host').getSelectionParentNode(),
            selection = this.get('host').getSelection(),
            text,
            returnValue = false;

        // Prevent resolving equations when we don't have focus.
        if (!this.get('host').isActive()) {
            return false;
        }

        // Note this is a document fragment and YUI doesn't like them.
        if (!selectedNode) {
            return false;
        }

        // We don't yet have a cursor selection somehow so we can't possible be resolving an equation that has selection.
        if (!selection || selection.length === 0) {
            return false;
        }

        this.sourceEquation = null;

        selection = selection[0];

        text = Y.one(selectedNode).get('text');

        // For each of these patterns we have a RegExp which captures the inner component of the equation but also
        // includes the delimiters.
        // We first run the RegExp adding the global flag ("g"). This ignores the capture, instead matching the entire
        // equation including delimiters and returning one entry per match of the whole equation.
        // We have to deal with multiple occurences of the same equation in a String so must be able to loop on the
        // match results.
        Y.Array.find(this._equationPatterns, function(pattern) {
            // For each pattern in turn, find all whole matches (including the delimiters).
            var patternMatches = text.match(new RegExp(pattern.source, "g"));

            if (patternMatches && patternMatches.length) {
                // This pattern matches at least once. See if this pattern matches our current position.
                // Note: We return here to break the Y.Array.find loop - any truthy return will stop any subsequent
                // searches which is the required behaviour of this function.
                return Y.Array.find(patternMatches, function(match) {
                    // Check each occurrence of this match.
                    var startIndex = 0;
                    while (text.indexOf(match, startIndex) !== -1) {
                        // Determine whether the cursor is in the current occurrence of this string.
                        // Note: We do not support a selection exceeding the bounds of an equation.
                        var startOuter = text.indexOf(match, startIndex),
                            endOuter = startOuter + match.length,
                            startMatch = (selection.startOffset >= startOuter && selection.startOffset < endOuter),
                            endMatch = (selection.endOffset <= endOuter && selection.endOffset > startOuter);

                        if (startMatch && endMatch) {
                            // This match is in our current position - fetch the innerMatch data.
                            var innerMatch = match.match(pattern);
                            if (innerMatch && innerMatch.length) {
                                // We need the start and end of the inner match for later.
                                var startInner = text.indexOf(innerMatch[1], startOuter),
                                    endInner = startInner + innerMatch[1].length;

                                // We'll be returning the inner match for use in the editor itself.
                                returnValue = innerMatch[1];

                                // Save all data for later.
                                this.sourceEquation = {
                                    // Outer match data.
                                    startOuterPosition: startOuter,
                                    endOuterPosition: endOuter,
                                    outerMatch: match,

                                    // Inner match data.
                                    startInnerPosition: startInner,
                                    endInnerPosition: endInner,
                                    innerMatch: innerMatch
                                };

                                // This breaks out of both Y.Array.find functions.
                                return true;
                            }
                        }

                        // Update the startIndex to match the end of the current match so that we can continue hunting
                        // for further matches.
                        startIndex = endOuter;
                    }
                }, this);
            }
        }, this);

        // We trim the equation when we load it and then add spaces when we save it.
        if (returnValue !== false) {
            returnValue = returnValue.trim();
        }
        return returnValue;
    },

    /**
     * Handle insertion of a new equation, or update of an existing one.
     *
     * @method _setEquation
     * @param {EventFacade} e
     * @private
     */
    _setEquation: function(e) {
        var input,
            selectedNode,
            text,
            value,
            host,
            newText;

        host = this.get('host');

        e.preventDefault();
        this.getDialogue({
            focusAfterHide: null
        }).hide();
        
        var value = document.getElementById('editorIFrame' ).contentWindow.getLatex() ;
		
        if (value !== '') {
            host.setSelection(this._currentSelection);

            if (this.sourceEquation) {
                // Replace the equation.
                selectedNode = Y.one(host.getSelectionParentNode());
                text = selectedNode.get('text');
                value = ' ' + value + ' ';
                newText = text.slice(0, this.sourceEquation.startInnerPosition) +
                            value +
                            text.slice(this.sourceEquation.endInnerPosition);

                selectedNode.set('text', newText);
            } else {
                // Insert the new equation.
                value = DELIMITERS.START + ' ' + value + ' ' + DELIMITERS.END;
                host.insertContentAtFocusPoint(value);
            }

            // Clean the YUI ids from the HTML.
            this.markUpdated();
        }
    },

    /**
     * Return the HTML for rendering the library of predefined buttons.
     *
     * @method _getLibraryContent
     * @return {string}
     * @private
     */
    _getLibraryContent: function() {
        var template = Y.Handlebars.compile(TEMPLATES.LIBRARY),
            library = this.get('library'),
            content = '';

        // Helper to iterate over a newline separated string.
        Y.Handlebars.registerHelper('split', function(delimiter, str, options) {
            var parts,
                current,
                out;
            if (typeof delimiter === "undefined" || typeof str === "undefined") {
                return '';
            }

            out = '';
            parts = str.trim().split(delimiter);
            while (parts.length > 0) {
                current = parts.shift().trim();
                out += options.fn(current);
            }

            return out;
        });
        content = template({
            elementid: this.get('host').get('elementid'),
            component: COMPONENTNAME,
            library: library,
            CSS: CSS,
            DELIMITERS: DELIMITERS
        });

        return content;
    },
    
    /**
     * Return the dialogue content for the tool, attaching any required
     * events.
     *
     * @method _getDialogueContent
     * @return {Node}
     * @private
     */
    _getDialogueContent: function() {
    	
    	var library = this._getLibraryContent(),
        template = Y.Handlebars.compile(TEMPLATES.FORM);
    	
    	this._content = Y.Node.create(template({
            elementid: this.get('host').get('elementid'),
            component: COMPONENTNAME,
            library: library,
            texdocsurl: this.get('texdocsurl'),
            CSS: CSS
        }));
    	
        this._content.one(SELECTORS.SUBMIT).on('click', this._setEquation, this);
        
        return this._content;
    }
    
}, {
    ATTRS: {
        /**
         * Whether the TeX filter is currently active.
         *
         * @attribute texfilteractive
         * @type Boolean
         */
        texfilteractive: {
            value: false
        },

        /**
         * The contextid to use when generating this preview.
         *
         * @attribute contextid
         * @type String
         */
        contextid: {
            value: null
        },

        /**
         * The content of the example library.
         *
         * @attribute library
         * @type object
         */
        library: {
            value: {}
        },

        /**
         * The link to the Moodle Docs page about TeX.
         *
         * @attribute texdocsurl
         * @type string
         */
        texdocsurl: {
            value: null
        }

    }
});

}, '@VERSION@', {
    "requires": [
        "moodle-editor_atto-plugin",
        "moodle-core-event",
        "io",
        "event-valuechange",
        "tabview",
        "array-extras"
    ]
});
